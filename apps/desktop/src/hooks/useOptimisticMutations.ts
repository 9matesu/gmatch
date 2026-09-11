"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import type { OptimisticUpdate, OrbitIdentity } from "../utils/adminTypes";

interface UseOptimisticMutationsOptions<T> {
  identity: OrbitIdentity | null;
  pinVerified: boolean;
  onError?: (error: Error, rollbackData: T | null) => void;
  onSuccess?: (data: T) => void;
}

interface MutationResult<T> {
  data: T | null;
  error: Error | null;
  isPending: boolean;
  rollback: () => void;
}

export function useOptimisticMutation<T, TData = unknown>(
  options: UseOptimisticMutationsOptions<T>
) {
  const { identity, pinVerified, onError, onSuccess } = options;
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const pendingUpdateRef = useRef<OptimisticUpdate<T> | null>(null);
  const rollbackDataRef = useRef<T | null>(null);

  const execute = useCallback(
    async (
      mutationFn: () => Promise<TData>,
      optimisticUpdate?: {
        type: 'create' | 'update' | 'delete';
        entity: string;
        id: string;
        previousData?: T;
        newData?: T;
      }
    ): Promise<MutationResult<T>> => {
      if (!identity || !pinVerified) {
        const err = new Error("Not authenticated");
        setError(err);
        return { data: null, error: err, isPending: false, rollback: () => {} };
      }

      setIsPending(true);
      setError(null);

      if (optimisticUpdate) {
        pendingUpdateRef.current = {
          ...optimisticUpdate,
          timestamp: Date.now(),
        };
      }

      try {
        const result = await mutationFn();
        setIsPending(false);
        pendingUpdateRef.current = null;
        rollbackDataRef.current = null;
        onSuccess?.(result as T);
        return { data: result as T, error: null, isPending: false, rollback: () => {} };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        setIsPending(false);

        if (rollbackDataRef.current && optimisticUpdate) {
          onError?.(error, rollbackDataRef.current);
        }
        return {
          data: null,
          error,
          isPending: false,
          rollback: () => {
            if (rollbackDataRef.current && optimisticUpdate) {
              onError?.(error, rollbackDataRef.current);
            }
          },
        };
      }
    },
    [identity, pinVerified, onError, onSuccess]
  );

  const rollback = useCallback(() => {
    if (rollbackDataRef.current && pendingUpdateRef.current) {
      const err = new Error("Rolled back");
      onError?.(err, rollbackDataRef.current);
      rollbackDataRef.current = null;
      pendingUpdateRef.current = null;
    }
  }, [onError]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    execute,
    rollback,
    clearError,
    isPending,
    error,
  };
}

interface UseOfflineQueueOptions {
  identity: OrbitIdentity | null;
  pinVerified: boolean;
  maxRetries?: number;
  retryDelay?: number;
}

interface QueuedMutation {
  id: string;
  mutationFn: () => Promise<unknown>;
  retries: number;
  timestamp: number;
}

export function useOfflineQueue(options: UseOfflineQueueOptions) {
  const { identity, pinVerified, maxRetries = 3, retryDelay = 5000 } = options;
  const [queue, setQueue] = useState<QueuedMutation[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);

  const addToQueue = useCallback(
    (mutationFn: () => Promise<unknown>) => {
      const mutation: QueuedMutation = {
        id: crypto.randomUUID(),
        mutationFn,
        retries: 0,
        timestamp: Date.now(),
      };
      setQueue(prev => [...prev, mutation]);
    },
    []
  );

  const processQueue = useCallback(async () => {
    if (processingRef.current || queue.length === 0 || !identity || !pinVerified) return;

    processingRef.current = true;
    setIsProcessing(true);

    while (queue.length > 0) {
      const mutation = queue[0];
      try {
        await mutation.mutationFn();
        setQueue(prev => prev.slice(1));
      } catch  {
        if (mutation.retries >= maxRetries) {
          setQueue(prev => prev.slice(1));
        } else {
          setQueue(prev => [
            { ...mutation, retries: mutation.retries + 1 },
            ...prev.slice(1),
          ]);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }

    processingRef.current = false;
    setIsProcessing(false);
  }, [queue, identity, pinVerified, maxRetries, retryDelay]);

  useEffect(() => {
    if (identity && pinVerified && queue.length > 0 && !isProcessing) {
      processQueue();
    }
  }, [identity, pinVerified, queue.length, isProcessing, processQueue]);

  return {
    addToQueue,
    queue,
    isProcessing,
    clearQueue: () => setQueue([]),
  };
}

