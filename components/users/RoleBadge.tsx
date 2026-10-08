import type { UserRole } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { ROLE_LABELS } from '@/lib/auth/roles';

const ROLE_TONES: Record<UserRole, 'violet' | 'red' | 'orange' | 'blue' | 'gray'> = {
  owner_panel: 'violet',
  admin: 'red',
  moderator: 'orange',
  user: 'blue',
  subuser: 'gray',
};

export function RoleBadge({ role }: { role: UserRole }) {
  return <Badge tone={ROLE_TONES[role]}>{ROLE_LABELS[role]}</Badge>;
}
