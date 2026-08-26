/**
 * Returns a getter that derives a per-key value from an array, cached by the
 * array's identity. The first call for a given array builds the full map
 * O(N); subsequent calls for the same array reference are O(1). The cache
 * releases memory as soon as the store replaces the array (WeakMap holds no
 * strong reference).
 *
 * Call sites keep their own typed empty-sentinel fallback at the use site:
 * `getThing(xs, key) ?? EMPTY_THINGS`.
 */
export function createArrayKeyedMap<S, K, V>(
  buildMap: (xs: S[]) => Map<K, V>,
): (xs: S[], key: K) => V | undefined {
  const cache = new WeakMap<S[], Map<K, V>>();
  return (xs, key) => {
    let map = cache.get(xs);
    if (!map) {
      map = buildMap(xs);
      cache.set(xs, map);
    }
    return map.get(key);
  };
}
