export type ApiError<T = unknown> = T & { errors: string[] };

export type ApiErrorResponse<T = unknown> = {
  error: ApiError<T>;
  data?: never;
  status?: number;
};

export interface ApiResponse<T> {
  data: T;
  isSuccess?: boolean;
  error?: unknown;
  status?: number;
}

export interface ApiPaginatedResponse<T> {
  data: T;
  totalCount: number;
  errors?: unknown;
  status?: number;
}
