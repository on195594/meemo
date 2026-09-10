/**
 * Meemo API and Domain TypeScript Type Definitions
 * RF-305: API Contract and Progressive Type Declarations
 */

export type ErrorCode =
    | 'invalid_request'
    | 'authentication_required'
    | 'invalid_credentials'
    | 'forbidden'
    | 'not_found'
    | 'conflict'
    | 'payload_too_large'
    | 'too_many_requests'
    | 'internal_error'
    | 'service_unavailable'
    | 'request_failed';

export interface ErrorResponse {
    status: string;
    code: ErrorCode;
    message: string;
}

// ---------------------------------------------------------------------------
// Domain Entities
// ---------------------------------------------------------------------------

export type UserStatus = 'active' | 'disabled';

export interface User {
    id: string;
    username: string;
    usernameNorm: string;
    displayName: string;
    email: string;
    passwordHash: string;
    createdAt: Date | number;
    status: UserStatus;
}

export interface UserProfile {
    id: string;
    username: string;
    displayName: string;
    email: string;
}

export interface PublicUserProfile {
    id: string;
    username: string;
    displayName: string;
}

export interface AttachmentDescriptor {
    identifier: string;
    fileName?: string;
    type?: 'image' | 'unknown' | string;
    mime?: string;
    size?: number;
}

export interface ExternalContentItem {
    url: string;
    type?: string;
    [key: string]: unknown;
}

export interface Thing {
    _id: string;
    ownerId: string;
    content: string;
    richContent: string;
    createdAt: number;
    modifiedAt: number;
    tags: string[];
    externalContent?: ExternalContentItem[];
    attachments: AttachmentDescriptor[];
    public: boolean;
    shared: boolean;
    archived: boolean;
    sticky: boolean;
}

export interface Tag {
    name: string;
    usage: number;
}

export interface Settings {
    [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// API Payloads & Contracts
// ---------------------------------------------------------------------------

// Auth
export interface RegisterRequest {
    username: string;
    password: string;
    email: string;
    displayName: string;
}

export type RegisterResponse = Record<string, never>;

export interface LoginRequest {
    username: string;
    password: string;
}

export type LoginResponse = Record<string, never>;

export type LogoutResponse = Record<string, never>;

export interface ProfileResponse {
    user: UserProfile;
}

// Things & Tags
export interface ListThingsQuery {
    filter?: string;
    sticky?: boolean;
    archived?: boolean;
    skip?: number;
    limit?: number;
}

export interface ListThingsResponse {
    things: Thing[];
}

export interface CreateThingRequest {
    content: string;
    attachments?: Array<string | AttachmentDescriptor>;
}

export interface CreateThingResponse {
    thing: Thing;
}

export interface GetThingResponse {
    thing: Thing;
}

export interface UpdateThingRequest {
    content: string;
    attachments?: Array<string | AttachmentDescriptor>;
    public?: boolean;
    shared?: boolean;
    archived?: boolean;
    sticky?: boolean;
}

export interface UpdateThingResponse {
    thing: Thing;
}

export type DeleteThingResponse = Record<string, never>;

export interface ListTagsResponse {
    tags: Tag[];
}

// Files & Attachments
export type UploadFileResponse = AttachmentDescriptor;

// Settings
export interface GetSettingsResponse {
    settings: Settings;
}

export interface SaveSettingsRequest {
    settings: Settings;
}

export type SaveSettingsResponse = Record<string, never>;

// Transfer
export interface ImportResult {
    imported: number;
    failed: number;
    total: number;
}

export type ImportResponse = ImportResult;

// Public & Discovery
export interface ListPublicThingsQuery {
    filter?: string;
    skip?: number;
    limit?: number;
}

export interface ListPublicThingsResponse {
    things: Thing[];
}

export interface GetPublicThingResponse {
    thing: Thing;
}

export interface ListPublicUsersResponse {
    users: PublicUserProfile[];
}

export interface GetPublicUserResponse {
    user: PublicUserProfile;
    notesCount?: number;
}

// Health Probes
export interface HealthLiveResponse {
    status: 'ok';
}

export interface HealthReadyResponse {
    status: 'ready';
}

export type HealthCheckResponse = Record<string, never>;
