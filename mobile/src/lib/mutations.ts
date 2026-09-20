import { enqueueMutation } from "@/lib/db/outbox";
import { isOfflineError, requestJson } from "@/lib/http";

/**
 * Mutations that survive being offline.
 *
 * Every user action is attempted against the server first — when there is a
 * connection, behaviour is exactly as before. Only a *transport* failure is
 * queued: if the server answered, even with an error, the request was delivered
 * and queueing it would replay a request the server has already rejected.
 *
 * The caller receives `undefined` when the mutation was queued, and the screens
 * treat that as success because they update their own state optimistically. The
 * outbox is drained on reconnect by the sync provider.
 */

export const mutateWithOutboxFallback = async <T>(
  method: string,
  path: string,
  body?: string,
): Promise<T | undefined> => {
  try {
    return await requestJson<T>(path, { method, body });
  } catch (error) {
    if (!isOfflineError(error)) {
      throw error;
    }

    try {
      await enqueueMutation(method, path, body);
    } catch (queueError) {
      // The request did not reach the server and could not be queued, so this
      // mutation is genuinely lost. Surface the original failure (the useful
      // one) and log the storage problem separately.
      if (__DEV__) {
        console.warn(
          `[mutations] Could not queue ${method} ${path} for later:`,
          queueError,
        );
      }
      throw error;
    }

    if (__DEV__) {
      console.log(`[mutations] Queued ${method} ${path} until back online`);
    }
    return undefined;
  }
};
