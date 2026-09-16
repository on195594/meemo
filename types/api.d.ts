/**
 * Meemo API and domain TypeScript declarations.
 * API contracts are generated from docs/openapi.yaml.
 */

import type { components, paths } from './generated/api-types';

export type ErrorCode = components['schemas']['ErrorResponse']['code'];
export type ErrorResponse = components['schemas']['ErrorResponse'];
export type UserProfile = components['schemas']['UserProfile'];
export type PublicUserProfile = components['schemas']['PublicUserProfile'];
export type PublicUserSummary = components['schemas']['PublicUserSummary'];
export type AttachmentDescriptor = components['schemas']['AttachmentDescriptor'];
export type Thing = components['schemas']['Thing'];
export type NoteColor = components['schemas']['NoteColor'];
export type Tag = components['schemas']['Tag'];
export type RegisterRequest = components['schemas']['RegisterRequest'];
export type LoginRequest = components['schemas']['LoginRequest'];
export type CreateThingRequest = components['schemas']['CreateThingRequest'];
export type UpdateThingRequest = components['schemas']['UpdateThingRequest'];
export type SaveSettingsRequest = components['schemas']['SaveSettingsRequest'];
export type ImportResult = components['schemas']['ImportResult'];
export type Settings = SaveSettingsRequest['settings'];

export type UserStatus = 'active' | 'disabled';

/** Internal persisted user; not part of the public OpenAPI contract. */
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

export type ExternalContentItem = components['schemas']['ExternalContentItem'];

type JsonResponse<
    Operation extends { responses: object },
    Status extends keyof Operation['responses'],
> = Operation['responses'][Status] extends {
    content: { 'application/json': infer Body };
} ? Body : never;

export type RegisterResponse = JsonResponse<paths['/api/register']['post'], 201>;
export type LoginResponse = JsonResponse<paths['/api/login']['post'], 200>;
export type LogoutResponse = JsonResponse<paths['/api/logout']['post'], 200>;
export type ProfileResponse = JsonResponse<paths['/api/profile']['get'], 200>;
export type ListThingsResponse = JsonResponse<paths['/api/things']['get'], 200>;
export type CreateThingResponse = JsonResponse<paths['/api/things']['post'], 201>;
export type GetThingResponse = JsonResponse<paths['/api/things/{id}']['get'], 200>;
export type UpdateThingResponse = JsonResponse<paths['/api/things/{id}']['put'], 201>;
export type DeleteThingResponse = JsonResponse<paths['/api/things/{id}']['delete'], 200>;
export type ListTagsResponse = JsonResponse<paths['/api/tags']['get'], 200>;
export type UploadFileResponse = JsonResponse<paths['/api/files']['post'], 201>;
export type GetSettingsResponse = JsonResponse<paths['/api/settings']['get'], 200>;
export type SaveSettingsResponse = JsonResponse<paths['/api/settings']['post'], 202>;
export type ImportResponse = JsonResponse<paths['/api/import']['post'], 200>;
export type ListPublicThingsResponse = JsonResponse<paths['/api/public/{userId}/things']['get'], 200>;
export type GetPublicThingResponse = JsonResponse<paths['/api/public/{userId}/things/{thingId}']['get'], 200>;
export type ListPublicUsersResponse = JsonResponse<paths['/api/users']['get'], 200>;
export type GetPublicUserResponse = JsonResponse<paths['/api/users/{userId}']['get'], 200>;
export type HealthLiveResponse = components['schemas']['HealthLiveResponse'];
export type HealthReadyResponse = components['schemas']['HealthReadyResponse'];
export type HealthCheckResponse = JsonResponse<paths['/api/healthcheck']['get'], 200>;

export type ListThingsQuery = paths['/api/things']['get']['parameters']['query'];
export type ListPublicThingsQuery = paths['/api/public/{userId}/things']['get']['parameters']['query'];
