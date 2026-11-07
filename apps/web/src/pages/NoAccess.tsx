import { useState } from 'react';
import { Clock, ShieldOff, UserPlus, Wand2 } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { Button, Card, EmptyState } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Me } from '../lib/types';

/** Shown inside the app when the user has no active access to the selected AY. */
export function NoAccess({ onSetup }: { onSetup?: () => void }) {
  const { ay, membership, setMe } = useAuth();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  if (!ay) return null;

  const requestAccess = async () => {
    const res = await api<{ status: string; me: Me }>('/ays/request-access', { method: 'POST' });
    setMe(res.me);
    toast(res.status === 'active' ? `You are now the adviser for AY ${ay.label}.` : 'Request sent to the adviser.');
  };

  const canRequest = ay.status === 'open' && (!membership || membership.status === 'rejected');

  let content;
  if (onSetup && membership?.status !== 'pending') {
    content = (
      <EmptyState
        icon={Wand2}
        title={`AY ${ay.label} hasn't been set up yet`}
        body="Copy the adviser, staff, settings, funds, balances and students from an earlier academic year, or start fresh."
        action={
          <Button onClick={onSetup}>
            <Wand2 className="size-4" aria-hidden /> Set up AY {ay.label}
          </Button>
        }
      />
    );
  } else if (membership?.status === 'pending') {
    content = (
      <EmptyState
        icon={Clock}
        title="Waiting for the adviser's approval"
        body={`Your account is registered for AY ${ay.label}. The adviser will approve it and assign your position. You'll get an email when that happens.`}
      />
    );
  } else if (membership?.status === 'deactivated') {
    content = (
      <EmptyState icon={ShieldOff} title="Access deactivated" body={`Your access to AY ${ay.label} was deactivated. Contact the adviser if this is a mistake.`} />
    );
  } else {
    content = (
      <EmptyState
        icon={UserPlus}
        title={membership?.status === 'rejected' ? 'Your request was not approved' : `You don't have access to AY ${ay.label}`}
        body={
          ay.status === 'closed'
            ? 'This academic year is closed, so new access requests are not accepted.'
            : 'Ask to join this academic year. If it has no adviser yet, you become its adviser.'
        }
        action={
          canRequest && (
            <Button onClick={() => setConfirming(true)}>
              <UserPlus className="size-4" aria-hidden /> Request access
            </Button>
          )
        }
      />
    );
  }

  return (
    <>
      <Card>{content}</Card>
      <ConfirmDialog
        open={confirming}
        title={`Request access to AY ${ay.label}?`}
        description="The adviser will be notified and can approve you with a position."
        confirmLabel="Send request"
        onConfirm={requestAccess}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
