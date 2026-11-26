// Types for the parts of homey-oauth2app (3.7) this app uses; the package ships none.
// Only for `tsc --noEmit` (npm run typecheck); the Homey CLI does not package *.ts files.

declare module 'homey-oauth2app' {
  import Homey from 'homey';

  export class OAuth2Error extends Error {
    constructor(message: string, statusCode?: number);
  }

  export class OAuth2Token {
    constructor(body: Record<string, any>);
    access_token: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
    isRefreshable(): boolean;
    toJSON(): Record<string, any>;
  }

  interface RequestArgs {
    path: string;
    query?: Record<string, any>;
    json?: any;
    body?: any;
    headers?: Record<string, string>;
  }

  export class OAuth2Client {
    static API_URL: string;
    static TOKEN_URL: string;
    static AUTHORIZATION_URL: string;
    static SCOPES: string[];
    static CLIENT_ID: string;
    static CLIENT_SECRET: string;
    homey: Homey.Homey;
    _token?: OAuth2Token;
    _clientId: string;
    _clientSecret: string;
    _redirectUrl: string;
    _authorizationUrl: string;
    _tokenUrl: string;
    _refreshingToken?: Promise<unknown>;
    log(...args: any[]): void;
    error(...args: any[]): void;
    debug(...args: any[]): void;
    save(): void;
    getToken(): OAuth2Token | undefined;
    setToken(args: { token: OAuth2Token }): void;
    get(args: RequestArgs): Promise<any>;
    post(args: RequestArgs): Promise<any>;
    onInit(): Promise<void>;
    onBuildRequest(args: RequestArgs & { method: string }): Promise<{ url: string, opts: Record<string, any> }>;
    onRequestError(args: { req: any, url: string, opts: any, err: unknown }): Promise<any>;
    onRequestResponse(args: { req?: any, url?: string, opts?: any, response: any, didRefreshToken?: boolean }): Promise<any>;
    onHandleAuthorizationURLScopes(args: { scopes?: string[] }): string;
  }

  export class OAuth2App extends Homey.App {
    static OAUTH2_CLIENT: typeof OAuth2Client;
    static OAUTH2_DEBUG: boolean;
    enableOAuth2Debug(): void;
    onOAuth2Init(): Promise<void>;
  }

  export class OAuth2Device extends Homey.Device {
    oAuth2Client: any;
    onOAuth2Init(): Promise<void>;
    onOAuth2Uninit(): Promise<void>;
    onOAuth2Deleted(): Promise<void>;
  }

  export class OAuth2Driver extends Homey.Driver {
    onOAuth2Init(): Promise<void>;
    onPairListDevices(args: { oAuth2Client: any }): Promise<any[]>;
  }
}
