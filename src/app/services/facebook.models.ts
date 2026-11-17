export interface InstagramAccount {
  id: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
}

export interface FacebookPage {
  id: string;
  name: string;
  category?: string;
  access_token: string;
  picture?: { data: { url: string } };
  /** Present only when an Instagram Business/Creator account is linked to the Page. */
  instagram_business_account?: InstagramAccount;
}

/** One selectable posting target: a Facebook Page or an Instagram account linked to one. */
export interface Destination {
  /** Unique key: the page id for Facebook, `ig:<igId>` for Instagram. */
  key: string;
  type: 'facebook' | 'instagram';
  label: string;
  sublabel: string;
  avatarUrl?: string;
  page: FacebookPage;
}

export interface PublishResult {
  pageId: string;
  pageName: string;
  platform: 'facebook' | 'instagram';
  ok: boolean;
  postId?: string;
  error?: string;
}
