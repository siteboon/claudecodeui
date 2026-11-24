/** Used within image-generation to expose fixed diagnostic codes without leaking provider responses or keys. */
export class ImageGenerationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly outcome: 'rejected' | 'uncertain' = 'rejected',
  ) {
    super(message);
    this.name = 'ImageGenerationError';
  }
}
