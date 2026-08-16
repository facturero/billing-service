export class Result<T, E = string> {
  private constructor(
    readonly isSuccess: boolean,
    readonly value?: T,
    readonly error?: E,
  ) {}

  static success<T, E = string>(value: T): Result<T, E> {
    return new Result<T, E>(true, value);
  }

  static failure<T, E = string>(error: E): Result<T, E> {
    return new Result<T, E>(false, undefined, error);
  }

  get isFailure(): boolean {
    return !this.isSuccess;
  }

  getOrThrow(): T {
    if (this.isFailure) throw new Error(String(this.error));
    return this.value as T;
  }

  map<U>(fn: (value: T) => U): Result<U, E> {
    if (this.isFailure) return Result.failure(this.error as E);
    return Result.success(fn(this.value as T));
  }

  flatMap<U>(fn: (value: T) => Result<U, E>): Result<U, E> {
    if (this.isFailure) return Result.failure(this.error as E);
    return fn(this.value as T);
  }
}
