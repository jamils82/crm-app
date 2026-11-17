import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../environments/environment';
import { FacebookService } from '../services/facebook.service';
import { Destination, FacebookPage, PublishResult } from '../services/facebook.models';

/**
 * Home page for the CRM Lite Angular shell.
 *
 * Scope (per current instructions): implement the Facebook Page connect +
 * post flow end-to-end against the real Graph API, using a dummy/test
 * Facebook App ID until a real app is provisioned (see environment.ts).
 *
 * Architecture note for later: this currently calls the Graph API directly
 * from the browser via the FB JS SDK, which is fine for login, reading
 * `/me/accounts`, and posting to `/feed` or `/photos` with a public image
 * URL. Once a backend exists, token exchange/storage and any raw file
 * uploads should move server-side — see the "Facebook + Angular
 * integration" discussion earlier in this project for the full plan.
 *
 * TEST-ONLY PERSISTENCE: the connected Pages (including their Page Access
 * Tokens) and the current page selection are cached in localStorage so you
 * don't have to redo the Facebook login dance on every reload while
 * testing. This is NOT safe for production — Page Access Tokens sitting in
 * localStorage are readable by any script/XSS on the origin. Once a
 * backend exists, this whole cache should be deleted in favor of
 * server-side token storage.
 */
// v2: cached pages now include linked Instagram accounts; old caches lack them.
const STORAGE_KEY = 'cfs-crm-fb-connection-v2';

interface StoredConnection {
  pages: FacebookPage[];
  selectedPageIds: string[];
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent {
  readonly usingPlaceholderAppId = environment.facebookAppId === '000000000000000';
  readonly hasLoginConfigId = !!environment.facebookLoginConfigId;

  readonly connecting = signal(false);
  readonly loadingPages = signal(false);
  readonly publishing = signal(false);
  readonly connectError = signal<string | null>(null);
  /** Instagram permissions Facebook did not grant on the last login. */
  readonly missingIgPermissions = signal<string[]>([]);

  readonly pages = signal<FacebookPage[]>([]);
  readonly selectedPageIds = signal<Set<string>>(new Set());
  readonly pagesDropdownOpen = signal(false);

  /** True once we have a connection either from a live login this session
   *  or restored from localStorage from an earlier session (test-only). */
  readonly restoredConnection = signal(false);

  postDescription =
    "Our Spring Fundraiser is live! 🌱 Every gift helps us reach this season's community goal.";
  imageUrl = '';
  localFile: File | null = null;
  localPreviewUrl: string | null = null;
  localFileName: string | null = null;

  readonly results = signal<PublishResult[]>([]);

  constructor(
    private readonly fb: FacebookService,
    private readonly host: ElementRef<HTMLElement>
  ) {
    this.restoreFromStorage();
  }

  get connected(): boolean {
    return this.fb.connected() || this.restoredConnection();
  }

  /** Every Facebook Page plus each Instagram account linked to one. */
  get destinations(): Destination[] {
    return this.pages().flatMap((page) => {
      const list: Destination[] = [
        {
          key: page.id,
          type: 'facebook',
          label: page.name,
          sublabel: page.category || 'Facebook Page',
          avatarUrl: page.picture?.data?.url,
          page
        }
      ];
      const ig = page.instagram_business_account;
      if (ig) {
        list.push({
          key: `ig:${ig.id}`,
          type: 'instagram',
          label: ig.username ? `@${ig.username}` : ig.name || 'Instagram account',
          sublabel: `Instagram · linked to ${page.name}`,
          avatarUrl: ig.profile_picture_url,
          page
        });
      }
      return list;
    });
  }

  get selectedDestinations(): Destination[] {
    const ids = this.selectedPageIds();
    return this.destinations.filter((d) => ids.has(d.key));
  }

  get instagramSelected(): boolean {
    return this.selectedDestinations.some((d) => d.type === 'instagram');
  }

  get hasImage(): boolean {
    return !!this.localFile || !!this.imageUrl.trim();
  }

  /** Instagram posts must include an image. */
  get missingImageForInstagram(): boolean {
    return this.instagramSelected && !this.hasImage;
  }

  get hasInstagramAccounts(): boolean {
    return this.destinations.some((d) => d.type === 'instagram');
  }

  get selectedSummary(): string {
    const selected = this.selectedDestinations;
    if (!selected.length) return 'Select accounts to post to…';
    if (selected.length > 2) return `${selected.length} accounts selected`;
    return selected.map((d) => d.label).join(', ');
  }

  async connect(forceReselect = false): Promise<void> {
    this.connectError.set(null);
    this.connecting.set(true);
    try {
      await this.fb.login(forceReselect);
      await this.loadPages();
    } catch (err) {
      this.connectError.set(err instanceof Error ? err.message : 'Failed to connect to Facebook.');
    } finally {
      this.connecting.set(false);
    }
  }

  /** Re-shows Facebook's login/asset-picker dialog to fix a zero-Pages grant. */
  async reconnectAndChoosePages(): Promise<void> {
    await this.connect(true);
  }

  async disconnect(): Promise<void> {
    await this.fb.logout();
    this.pages.set([]);
    this.selectedPageIds.set(new Set());
    this.results.set([]);
    this.restoredConnection.set(false);
    this.clearStorage();
  }

  private async loadPages(): Promise<void> {
    this.loadingPages.set(true);
    try {
      const pages = await this.fb.fetchPages();
      this.pages.set(pages);
      // Pre-select every page the user manages by default.
      this.selectedPageIds.set(new Set(this.destinations.map((d) => d.key)));
      this.restoredConnection.set(true);
      this.saveToStorage();

      const granted = await this.fb.fetchGrantedPermissions();
      console.info('[FB] granted permissions:', granted);
      this.missingIgPermissions.set(
        ['instagram_basic', 'instagram_content_publish'].filter((p) => !granted.includes(p))
      );
    } catch (err) {
      this.connectError.set(err instanceof Error ? err.message : 'Failed to load pages.');
    } finally {
      this.loadingPages.set(false);
    }
  }

  togglePagesDropdown(): void {
    this.pagesDropdownOpen.update((open) => !open);
  }

  togglePage(pageId: string, checked: boolean): void {
    const next = new Set(this.selectedPageIds());
    if (checked) {
      next.add(pageId);
    } else {
      next.delete(pageId);
    }
    this.selectedPageIds.set(next);
    this.saveToStorage();

    // Close the dropdown as soon as a page is (de)selected.
    this.pagesDropdownOpen.set(false);
  }

  /** Test-only: cache pages + selection so a reload doesn't require re-login. */
  private saveToStorage(): void {
    const data: StoredConnection = {
      pages: this.pages(),
      selectedPageIds: Array.from(this.selectedPageIds())
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Ignore storage failures (private browsing, quota, etc.) — this is a
      // convenience cache only, not the source of truth.
    }
  }

  private restoreFromStorage(): void {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    try {
      const data = JSON.parse(raw) as StoredConnection;
      if (!data.pages?.length) return;

      this.pages.set(data.pages);
      this.selectedPageIds.set(new Set(data.selectedPageIds ?? []));
      this.restoredConnection.set(true);
    } catch {
      this.clearStorage();
    }
  }

  private clearStorage(): void {
    localStorage.removeItem(STORAGE_KEY);
  }

  isPageSelected(pageId: string): boolean {
    return this.selectedPageIds().has(pageId);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.pagesDropdownOpen()) return;
    if (!this.host.nativeElement.querySelector('.ms-dropdown')?.contains(event.target as Node)) {
      this.pagesDropdownOpen.set(false);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.localFile = file;
    this.localFileName = file.name;
    const reader = new FileReader();
    reader.onload = () => (this.localPreviewUrl = reader.result as string);
    reader.readAsDataURL(file);
  }

  clearLocalFile(): void {
    this.localFile = null;
    this.localPreviewUrl = null;
    this.localFileName = null;
  }

  async publish(): Promise<void> {
    const targets = this.selectedDestinations;
    if (!targets.length || !this.postDescription.trim() || this.missingImageForInstagram) return;

    this.publishing.set(true);
    this.results.set([]);
    try {
      const message = this.postDescription;
      const url = this.imageUrl.trim();
      // A local file wins over the URL field when both are provided.
      const image: File | string | null = this.localFile ?? (url || null);

      // Instagram needs a public URL. For a local file, upload it once (unpublished)
      // via the first Instagram target's page and reuse the URL for every account.
      let instagramUrl: string | null = typeof image === 'string' ? image : null;
      const firstIg = targets.find((d) => d.type === 'instagram');
      let igPrepError: string | null = null;
      if (firstIg && image instanceof File) {
        try {
          instagramUrl = await this.fb.uploadForInstagram(firstIg.page, image);
        } catch (err) {
          igPrepError = err instanceof Error ? err.message : 'Image upload failed.';
        }
      }

      const outcomes = await Promise.all(
        targets.map((d): Promise<PublishResult> => {
          if (d.type === 'instagram') {
            if (!instagramUrl) {
              return Promise.resolve({
                pageId: d.page.id,
                pageName: d.label,
                platform: 'instagram',
                ok: false,
                error: igPrepError ?? 'An image is required for Instagram.'
              });
            }
            return this.fb.publishInstagramPost(d.page, message, instagramUrl);
          }
          return image
            ? this.fb.publishPhotoPost(d.page, message, image)
            : this.fb.publishTextPost(d.page, message);
        })
      );
      this.results.set(outcomes);
    } finally {
      this.publishing.set(false);
    }
  }
}
