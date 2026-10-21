import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ME_KEY } from '../context/auth-context';
import { userService } from '../services/user.service';

export function useConnectLeetCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: userService.connectLeetCode,
    onSuccess: (user) => queryClient.setQueryData(ME_KEY, user),
  });
}
