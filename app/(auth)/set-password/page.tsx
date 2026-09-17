import type { Metadata } from 'next';
import { SetPasswordForm } from './SetPasswordForm';

export const metadata: Metadata = { title: 'Activa tu cuenta · REKREATIVE OS' };

export default function SetPasswordPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <SetPasswordForm />
    </div>
  );
}
