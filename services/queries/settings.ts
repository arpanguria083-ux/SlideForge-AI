import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService, UpdateLlmProviderPayload } from '../apiService';

export const settingsKeys = {
  llmProvider: ['settings', 'llm-provider'] as const,
  analysis: ['settings', 'analysis'] as const,
  grammar: ['settings', 'grammar'] as const,
  sessionMetrics: (includeSessions: boolean) =>
    ['settings', 'session-metrics', includeSessions] as const,
};

export const useLlmProvider = () =>
  useQuery({
    queryKey: settingsKeys.llmProvider,
    queryFn: () => apiService.getLlmProvider(),
  });

export const useAnalysisSettings = () =>
  useQuery({
    queryKey: settingsKeys.analysis,
    queryFn: () => apiService.getAnalysisSettings(),
  });

export const useGrammarStatus = () =>
  useQuery({
    queryKey: settingsKeys.grammar,
    queryFn: () => apiService.getGrammarStatus(),
  });

export const useSetLlmProvider = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateLlmProviderPayload) => apiService.setLlmProvider(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.llmProvider });
    },
  });
};

export const useSessionMetrics = (
  includeSessions = false,
  enabled = true
) =>
  useQuery({
    queryKey: settingsKeys.sessionMetrics(includeSessions),
    queryFn: () => apiService.getSessionMetrics(includeSessions),
    enabled,
    refetchInterval: 15_000,
  });
