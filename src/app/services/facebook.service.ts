import { Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { FacebookPage, PublishResult } from './facebook.models';
import { FacebookSDK } from '../types/facebook-sdk';

/**
 * Thin wrapper around the Facebook JavaScript SDK.
 *
 * NOTE — this talks to the Graph API directly from the browser using the
 * SDK, which is fine for `pages_show_list` (read) and text/link posts to
 * `/feed`, and for `/photos` when given a public image URL. Real file
 * uploads and long-lived token storage should go through a backend once
 * one exists — see the header comment in home.component.ts for the plan.
 */
@Injectable({ providedIn: 'root' })
export class FacebookService {
  readonly connected = signal(false);
  readonly userAccessToken = signal<string | null>(null);

  private sdkPromise: Promise<FacebookSDK> | null = null;

  /** Injects the FB SDK script (once) and resolves once FB.init has run. */
  loadSdk(): Promise<FacebookSDK> {
    if (this.sdkPromise) {
      return this.sdkPromise;
    }

    this.sdkPromise = new Promise<FacebookSDK>((resolve) => {
      if (window.FB) {
        resolve(window.FB);
        return;
      }

      window.fbAsyncInit = () => {
        window.FB!.init({
          appId: environment.facebookAppId,
          cookie: true,
          xfbml: false,
          version: environment.facebookApiVersion
        });
        resolve(window.FB!);
      };

      const script = document.createElement('script');
      script.id = 'facebook-jssdk';
      script.src = 'https://connect.facebook.net/en_US/sdk.js';
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
    });

    return this.sdkPromise;
  }

  /**
   * @param forceReselect - passes `auth_type: 'rerequest'` so Facebook
   * re-shows the login/asset-picker dialog instead of silently reusing a
   * prior decision. Needed when the first login granted zero Pages (e.g.
   * because no Page was linked to the app's Business Portfolio yet) —
   * without this, Facebook just replays that empty grant on every
   * subsequent login and `/me/accounts` stays empty forever.
   */
  async login(forceReselect = false): Promise<string> {
    const fb = await this.loadSdk();

    // Newer apps must use a Facebook Login for Business configuration
    // (config_id) to request Page permissions — classic scope strings for
    // pages_show_list/pages_manage_posts/pages_read_engagement are rejected
    // with "Invalid Scopes" on apps created after Meta's 2023 policy change.
    // response_type: 'token' keeps this working purely client-side (no
    // backend code exchange) while still using the required config flow.
    const loginOptions = environment.facebookLoginConfigId
      ? {
          config_id: environment.facebookLoginConfigId,
          response_type: 'token' as const,
          override_default_response_type: true,
          ...(forceReselect ? { auth_type: 'rerequest' as const } : {})
        }
      : {
          scope:
            'public_profile,pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish',
          ...(forceReselect ? { auth_type: 'rerequest' as const } : {})
        };

    return new Promise<string>((resolve, reject) => {
      fb.login((response) => {
        if (response.status === 'connected' && response.authResponse) {
          this.connected.set(true);
          this.userAccessToken.set(response.authResponse.accessToken);
          resolve(response.authResponse.accessToken);
        } else {
          this.connected.set(false);
          this.userAccessToken.set(null);
          reject(new Error('Facebook login was cancelled or not authorized.'));
        }
      }, loginOptions);
    });
  }

  async logout(): Promise<void> {
    const fb = await this.loadSdk();
    return new Promise<void>((resolve) => {
      fb.logout(() => {
        this.connected.set(false);
        this.userAccessToken.set(null);
        resolve();
      });
    });
  }

  /** Pages the logged-in user manages, each with its own Page Access Token (plus linked Instagram account, if any). */
  async fetchPages(): Promise<FacebookPage[]> {
    const fb = await this.loadSdk();
    return new Promise<FacebookPage[]>((resolve, reject) => {
      const fields =
        'id,name,category,access_token,picture,' +
        'instagram_business_account{id,username,name,profile_picture_url},' +
        'connected_instagram_account{id,username,name,profile_picture_url}';
      fb.api('/me/accounts', { fields }, (response) => {
        if (!response || response.error) {
          reject(new Error(response?.error?.message ?? 'Failed to load pages.'));
          return;
        }
        const pages = ((response.data ?? []) as any[]).map((p) => {
          // Pages linked via "Linked accounts" can appear under either field.
          const ig = p.instagram_business_account ?? p.connected_instagram_account;
          const { connected_instagram_account, ...rest } = p;
          return (ig ? { ...rest, instagram_business_account: ig } : rest) as FacebookPage;
        });
        console.info('[FB] /me/accounts result:', pages.map((p) => ({ page: p.name, instagram: p.instagram_business_account ?? null })));
        resolve(pages);
      });
    });
  }

  /** Permissions currently granted to the logged-in user (granted ones only). */
  async fetchGrantedPermissions(): Promise<string[]> {
    const fb = await this.loadSdk();
    return new Promise<string[]>((resolve) => {
      fb.api('/me/permissions', {}, (response) => {
        const list = (response?.data ?? []) as { permission: string; status: string }[];
        resolve(list.filter((p) => p.status === 'granted').map((p) => p.permission));
      });
    });
  }

  private get graphBase(): string {
    return `https://graph.facebook.com/${environment.facebookApiVersion}`;
  }

  private fail(page: FacebookPage, platform: PublishResult['platform'], err: unknown): PublishResult {
    return {
      pageId: page.id,
      pageName: platform === 'instagram' ? `@${page.instagram_business_account?.username ?? page.name}` : page.name,
      platform,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }

  /** Calls the Graph API with fetch (needed for multipart file uploads, which FB.api can't do). */
  private async graph<T>(path: string, init?: RequestInit, query?: Record<string, string>): Promise<T> {
    const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
    const res = await fetch(`${this.graphBase}${path}${qs}`, init);
    const json = await res.json();
    if (!res.ok || json.error) {
      throw new Error(json.error?.message ?? `Graph API error (${res.status})`);
    }
    return json as T;
  }

  /** Publishes a text/link post to a single page's feed. */
  async publishTextPost(page: FacebookPage, message: string): Promise<PublishResult> {
    try {
      const body = new URLSearchParams({ message, access_token: page.access_token });
      const res = await this.graph<{ id: string }>(`/${page.id}/feed`, { method: 'POST', body });
      return { pageId: page.id, pageName: page.name, platform: 'facebook', ok: true, postId: res.id };
    } catch (err) {
      return this.fail(page, 'facebook', err);
    }
  }

  /**
   * Publishes a photo post to a Facebook Page. Accepts either a local File
   * (uploaded as multipart `source`) or a publicly reachable image URL.
   */
  async publishPhotoPost(page: FacebookPage, message: string, image: File | string): Promise<PublishResult> {
    try {
      const body = new FormData();
      body.append('access_token', page.access_token);
      body.append('caption', message);
      if (typeof image === 'string') {
        body.append('url', image);
      } else {
        body.append('source', image, image.name);
      }
      const res = await this.graph<{ id: string; post_id?: string }>(`/${page.id}/photos`, { method: 'POST', body });
      return { pageId: page.id, pageName: page.name, platform: 'facebook', ok: true, postId: res.post_id ?? res.id };
    } catch (err) {
      return this.fail(page, 'facebook', err);
    }
  }

  /**
   * Instagram can only ingest images from a public URL, so a local file is
   * first uploaded to the Page as an *unpublished* photo (not visible on the
   * Page timeline) and its CDN URL is then handed to Instagram.
   */
  async uploadForInstagram(page: FacebookPage, file: File): Promise<string> {
    const body = new FormData();
    body.append('access_token', page.access_token);
    body.append('published', 'false');
    body.append('source', file, file.name);
    const up = await this.graph<{ id: string }>(`/${page.id}/photos`, { method: 'POST', body });
    const info = await this.graph<{ images?: { source: string }[] }>(`/${up.id}`, undefined, {
      fields: 'images',
      access_token: page.access_token
    });
    const url = info.images?.[0]?.source;
    if (!url) throw new Error('Could not obtain a public URL for the uploaded image.');
    return url;
  }

  /** Publishes a single-image post to the Instagram account linked to `page`. Image is required. */
  async publishInstagramPost(page: FacebookPage, caption: string, imageUrl: string): Promise<PublishResult> {
    const ig = page.instagram_business_account;
    const name = `@${ig?.username ?? page.name}`;
    if (!ig) {
      return { pageId: page.id, pageName: name, platform: 'instagram', ok: false, error: 'No Instagram account linked.' };
    }
    try {
      const container = await this.graph<{ id: string }>(`/${ig.id}/media`, {
        method: 'POST',
        body: new URLSearchParams({ image_url: imageUrl, caption, access_token: page.access_token })
      });

      // Wait for Instagram to finish fetching/processing the image.
      for (let i = 0; i < 10; i++) {
        const status = await this.graph<{ status_code?: string }>(`/${container.id}`, undefined, {
          fields: 'status_code',
          access_token: page.access_token
        });
        if (status.status_code === 'FINISHED' || !status.status_code) break;
        if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
          throw new Error('Instagram could not process the image (use a JPEG, under 8 MB).');
        }
        await new Promise((r) => setTimeout(r, 1500));
      }

      const published = await this.graph<{ id: string }>(`/${ig.id}/media_publish`, {
        method: 'POST',
        body: new URLSearchParams({ creation_id: container.id, access_token: page.access_token })
      });
      return { pageId: page.id, pageName: name, platform: 'instagram', ok: true, postId: published.id };
    } catch (err) {
      return this.fail(page, 'instagram', err);
    }
  }
}
