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

export interface Thing {
  _id: string;
  ownerId: string;
  content: string;
  richContent: string;
  createdAt: number;
  modifiedAt: number;
  tags: string[];
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
    login: (username: string, password: string) =>
      request<{}>('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    logout: () =>
      request<{}>('/api/logout', {
        method: 'POST',
      }),
    register: (data: { username: string; password: string; email: string; displayName: string }) =>
      request<{}>('/api/register', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    profile: () => request<{ user: UserProfile }>('/api/profile'),
  },

  things: {
    list: (params?: { filter?: string; sticky?: boolean; archived?: boolean; skip?: number; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.filter) query.set('filter', params.filter);
      if (params?.sticky !== undefined) query.set('sticky', String(params.sticky));
      if (params?.archived !== undefined) query.set('archived', String(params.archived));
      if (params?.skip !== undefined) query.set('skip', String(params.skip));
      if (params?.limit !== undefined) query.set('limit', String(params.limit));
      const qs = query.toString();
      return request<{ things: Thing[] }>(`/api/things${qs ? '?' + qs : ''}`);
    },
    get: (id: string) => request<{ thing: Thing }>(`/api/things/${id}`),
    create: (data: { content: string; attachments?: AttachmentDescriptor[] }) =>
      request<{ thing: Thing }>('/api/things', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Thing>) =>
      request<{ thing: Thing }>(`/api/things/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<{}>(`/api/things/${id}`, {
        method: 'DELETE',
      }),
    tags: () => request<{ tags: Tag[] }>('/api/tags'),
  },

  files: {
    upload: (file: File, onProgress?: (percent: number) => void): Promise<AttachmentDescriptor> => {
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
    importArchive: (file: File, onProgress?: (percent: number) => void): Promise<{ total: number; imported: number; failed: number }> => {
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
    get: () => request<{ settings: Record<string, unknown> }>('/api/settings'),
    save: (settings: Record<string, unknown>) =>
      request<{}>('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ settings }),
      }),
  },

  public: {
    listThings: (userId: string, params?: { filter?: string; skip?: number; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.filter) query.set('filter', params.filter);
      if (params?.skip !== undefined) query.set('skip', String(params.skip));
      if (params?.limit !== undefined) query.set('limit', String(params.limit));
      const qs = query.toString();
      return request<{ things: Thing[] }>(`/api/public/${userId}/things${qs ? '?' + qs : ''}`);
    },
    getThing: (userId: string, thingId: string) =>
      request<{ thing: Thing }>(`/api/public/${userId}/things/${thingId}`),
    users: () => request<{ users: PublicUserProfile[] }>('/api/users'),
    userProfile: (userId: string) =>
      request<{ user: PublicUserProfile; notesCount?: number }>(`/api/users/${userId}`),
  },

  health: {
    live: () => request<{ status: string }>('/api/health/live'),
    ready: () => request<{ status: string }>('/api/health/ready'),
  },
};
