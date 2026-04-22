import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../apiService';
import { sessionKeys } from './sessions';

export const guardrailKeys = {
  current: (sessionId: string) => ['guardrail', sessionId, 'current'] as const,
  templates: (sessionId: string) => ['guardrail', sessionId, 'templates'] as const,
};

export const useSessionGuardrail = (sessionId: string | null) =>
  useQuery({
    queryKey: sessionId
      ? guardrailKeys.current(sessionId)
      : ['guardrail', 'current', 'disabled'],
    queryFn: () => apiService.getSessionGuardrail(sessionId as string),
    enabled: Boolean(sessionId),
  });

export const useGuardrailTemplates = (sessionId: string | null) =>
  useQuery({
    queryKey: sessionId
      ? guardrailKeys.templates(sessionId)
      : ['guardrail', 'templates', 'disabled'],
    queryFn: () => apiService.listGuardrailTemplates(sessionId as string),
    enabled: Boolean(sessionId),
  });

export const useActivateTemplate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, templateId }: { sessionId: string; templateId: string }) =>
      apiService.activateGuardrailTemplate(sessionId, templateId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: guardrailKeys.current(variables.sessionId),
      });
      queryClient.invalidateQueries({
        queryKey: guardrailKeys.templates(variables.sessionId),
      });
      queryClient.invalidateQueries({
        queryKey: sessionKeys.scorecard(variables.sessionId),
      });
    },
  });
};
