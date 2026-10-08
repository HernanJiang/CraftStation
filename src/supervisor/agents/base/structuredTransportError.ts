/** An unfinished turn whose native transport must be rebuilt before resuming. */
export class StructuredTransportError extends Error {
  override readonly name = "StructuredTransportError";
  readonly code = "STRUCTURED_TRANSPORT_INTERRUPTED";
}
