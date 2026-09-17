import type { components, paths } from '../../../types/generated/api-types';

export interface ApiErrorDetails {
  status: string;
  code: string;
  message: string;
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export type UserProfile = components['schemas']['UserProfile'];
export type PublicUserProfile = components['schemas']['PublicUserProfile'];
export type PublicUserSummary = components['schemas']['PublicUserSummary'];
export type AttachmentDescriptor = components['schemas']['AttachmentDescriptor'];
export type Thing = components['schemas']['Thing'];
export type NoteColor = components['schemas']['NoteColor'];
export type Tag = components['schemas']['Tag'];

type JsonResponse<
  Operation extends { responses: object },
  Status extends keyof Operation['responses'],
> = Operation['responses'][Status] extends {
  content: { 'application/json': infer Body };
} ? Body : never;

type RegisterRequest = components['schemas']['RegisterRequest'];
type LoginRequest = components['schemas']['LoginRequest'];
type CreateThingRequest = components['schemas']['CreateThingRequest'];
type UpdateThingRequest = components['schemas']['UpdateThingRequest'];
type SaveSettingsRequest = components['schemas']['SaveSettingsRequest'];
type UploadFileResponse = JsonResponse<paths['/api/files']['post'], 201>;
type ImportResponse = JsonResponse<paths['/api/import']['post'], 200>;
type ListThingsQuery = paths['/api/things']['get']['parameters']['query'];
type ListPublicThingsQuery = paths['/api/public/{userId}/things']['get']['parameters']['query'];
type ProfileResponse = JsonResponse<paths['/api/profile']['get'], 200>;
type ListThingsResponse = JsonResponse<paths['/api/things']['get'], 200>;
type GetThingResponse = JsonResponse<paths['/api/things/{id}']['get'], 200>;
type CreateThingResponse = JsonResponse<paths['/api/things']['post'], 201>;
type UpdateThingResponse = JsonResponse<paths['/api/things/{id}']['put'], 201>;
type ListTagsResponse = JsonResponse<paths['/api/tags']['get'], 200>;
type GetSettingsResponse = JsonResponse<paths['/api/settings']['get'], 200>;
type ListPublicThingsResponse = JsonResponse<paths['/api/public/{userId}/things']['get'], 200>;
type GetPublicThingResponse = JsonResponse<paths['/api/public/{userId}/things/{thingId}']['get'], 200>;
type ListPublicUsersResponse = JsonResponse<paths['/api/users']['get'], 200>;
type GetPublicUserResponse = JsonResponse<paths['/api/users/{userId}']['get'], 200>;
type HealthLiveResponse = JsonResponse<paths['/api/health/live']['get'], 200>;
type HealthReadyResponse = JsonResponse<paths['/api/health/ready']['get'], 200>;

export type UnauthorizedHandler = (path: string, error: ApiError) => void;
const unauthorizedHandlers = new Set<UnauthorizedHandler>();

export function onUnauthorized(handler: UnauthorizedHandler): () => void {
  unauthorizedHandlers.add(handler);
  return () => {
    unauthorizedHandlers.delete(handler);
  };
}

function notifyUnauthorized(path: string, error: ApiError): void {
  for (const handler of unauthorizedHandlers) {
    try {
      handler(path, error);
    } catch (e) {
      console.error('Unauthorized handler threw an error:', e);
    }
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
  });

  if (!response.ok) {
    let errorCode = 'request_failed';
    let errorMessage = response.statusText;
    try {
      const errorJson = (await response.json()) as ApiErrorDetails;
      if (errorJson.code) errorCode = errorJson.code;
      if (errorJson.message) errorMessage = errorJson.message;
    } catch {
      // Body not JSON, fallback to statusText
    }
    const apiError = new ApiError(response.status, errorCode, errorMessage);
    if (response.status === 401 && !path.startsWith('/api/login') && !path.startsWith('/api/register')) {
      notifyUnauthorized(path, apiError);
    }
    throw apiError;
  }

  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return {} as T;
  }

  return (await response.json()) as T;
}

export const api = {
  auth: {
    login: (username: LoginRequest['username'], password: LoginRequest['password']) =>
      request<{}>('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    logout: () =>
      request<{}>('/api/logout', {
        method: 'POST',
      }),
    register: (data: RegisterRequest) =>
      request<{}>('/api/register', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    profile: () => request<ProfileResponse>('/api/profile'),
  },

  things: {
    list: (params?: ListThingsQuery) => {
      const query = new URLSearchParams();
      if (params?.filter) query.set('filter', params.filter);
      if (params?.mode) query.set('mode', params.mode);
      if (params?.sticky !== undefined) query.set('sticky', String(params.sticky));
      if (params?.archived !== undefined) query.set('archived', String(params.archived));
      if (params?.skip !== undefined) query.set('skip', String(params.skip));
      if (params?.limit !== undefined) query.set('limit', String(params.limit));
      const qs = query.toString();
      return request<ListThingsResponse>(`/api/things${qs ? '?' + qs : ''}`);
    },
    get: (id: string) => request<GetThingResponse>(`/api/things/${id}`),
    create: (data: CreateThingRequest) =>
      request<CreateThingResponse>('/api/things', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: UpdateThingRequest) =>
      request<UpdateThingResponse>(`/api/things/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<{}>(`/api/things/${id}`, {
        method: 'DELETE',
      }),
    tags: () => request<ListTagsResponse>('/api/tags'),
  },

  files: {
    upload: (file: File, onProgress?: (percent: number) => void): Promise<UploadFileResponse> => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/files');
        xhr.withCredentials = true;

        if (onProgress && xhr.upload) {
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              onProgress(Math.round((event.loaded / event.total) * 100));
            }
          };
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch {
              reject(new ApiError(xhr.status, 'parse_error', 'Failed to parse response'));
            }
          } else {
            let code = 'upload_failed';
            let message = xhr.statusText;
            try {
              const err = JSON.parse(xhr.responseText);
              if (err.code) code = err.code;
              if (err.message) message = err.message;
            } catch {}
            const apiError = new ApiError(xhr.status, code, message);
            if (xhr.status === 401) {
              notifyUnauthorized('/api/files', apiError);
            }
            reject(apiError);
          }
        };

        xhr.onerror = () => {
          reject(new ApiError(0, 'network_error', 'Upload network failed'));
        };

        const formData = new FormData();
        formData.append('file', file);
        xhr.send(formData);
      });
    },
  },

  transfer: {
    importArchive: (file: File, onProgress?: (percent: number) => void): Promise<ImportResponse> => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/import');
        xhr.withCredentials = true;

        if (onProgress && xhr.upload) {
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              onProgress(Math.round((event.loaded / event.total) * 100));
            }
          };
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch {
              reject(new ApiError(xhr.status, 'parse_error', 'Failed to parse import response'));
            }
          } else {
            let code = 'import_failed';
            let message = xhr.statusText;
            try {
              const err = JSON.parse(xhr.responseText);
              if (err.code) code = err.code;
              if (err.message) message = err.message;
            } catch {}
            const apiError = new ApiError(xhr.status, code, message);
            if (xhr.status === 401) {
              notifyUnauthorized('/api/import', apiError);
            }
            reject(apiError);
          }
        };

        xhr.onerror = () => {
          reject(new ApiError(0, 'network_error', 'Import network failed'));
        };

        const formData = new FormData();
        formData.append('file', file);
        xhr.send(formData);
      });
    },
    exportUrl: () => '/api/export',
  },

  settings: {
    get: () => request<GetSettingsResponse>('/api/settings'),
    save: (settings: SaveSettingsRequest['settings']) =>
      request<{}>('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ settings }),
      }),
  },

  public: {
    listThings: (userId: string, params?: ListPublicThingsQuery) => {
      const query = new URLSearchParams();
      if (params?.filter) query.set('filter', params.filter);
      if (params?.mode) query.set('mode', params.mode);
      if (params?.skip !== undefined) query.set('skip', String(params.skip));
      if (params?.limit !== undefined) query.set('limit', String(params.limit));
      const qs = query.toString();
      return request<ListPublicThingsResponse>(`/api/public/${userId}/things${qs ? '?' + qs : ''}`);
    },
    getThing: (userId: string, thingId: string) =>
      request<GetPublicThingResponse>(`/api/public/${userId}/things/${thingId}`),
    users: () => request<ListPublicUsersResponse>('/api/users'),
    userProfile: (userId: string) =>
      request<GetPublicUserResponse>(`/api/users/${userId}`),
  },

  health: {
    live: () => request<HealthLiveResponse>('/api/health/live'),
    ready: () => request<HealthReadyResponse>('/api/health/ready'),
  },
};
