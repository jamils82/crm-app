// Minimal shape of the global Facebook JavaScript SDK object.
// Only the members this app actually uses are declared — the real SDK
// surface is much larger. See https://developers.facebook.com/docs/javascript

export interface FacebookAuthResponse {
  accessToken: string;
  code?: string;
  userID: string;
  expiresIn: number;
  signedRequest: string;
  grantedScopes?: string;
}

export interface FacebookLoginStatusResponse {
  status: 'connected' | 'not_authorized' | 'unknown';
  authResponse?: FacebookAuthResponse;
}

export interface FacebookSDK {
  init(params: {
    appId: string;
    cookie?: boolean;
    xfbml?: boolean;
    version: string;
  }): void;
  login(
    callback: (response: FacebookLoginStatusResponse) => void,
    options?: {
      scope?: string;
      return_scopes?: boolean;
      config_id?: string;
      response_type?: 'token' | 'code' | 'code%20token';
      override_default_response_type?: boolean;
      auth_type?: 'rerequest' | 'reauthenticate';
    }
  ): void;
  logout(callback?: (response: unknown) => void): void;
  getLoginStatus(callback: (response: FacebookLoginStatusResponse) => void): void;
  api(
    path: string,
    method: string,
    params: Record<string, unknown>,
    callback: (response: any) => void
  ): void;
  api(path: string, params: Record<string, unknown>, callback: (response: any) => void): void;
  api(path: string, callback: (response: any) => void): void;
}

declare global {
  interface Window {
    FB?: FacebookSDK;
    fbAsyncInit?: () => void;
  }
}

export {};
