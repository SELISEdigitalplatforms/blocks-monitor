export type APIError<T = unknown> = T & { errors: string[] };

export type APIErrorResponse<T = unknown> = {
 error: APIError<T>;
  data?: never;
  status?: number;
};


export interface APIResponse<T> {
 data: T;
  isSuccess?: boolean;
  error?: unknown;
  status?: number;
}

export interface APIListResponse<T> {
  data: T;
  totalCount: number;
  errors?: unknown;
  status?: number;
}
