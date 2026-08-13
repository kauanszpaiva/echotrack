import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Card, Button, Input } from '../../components/ui/Common';
import { safeFetch } from '../../lib/fetchUtils';
import { useAuth } from '../../hooks/useAuth';
import { Logo } from '../../components/Logo';

export function SetupAccount() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const { login } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    if (!token) return toast.error('No invite token provided');
    if (password !== confirmPassword) return toast.error('Passwords do not match');

    setLoading(true);
    try {
      const res = await safeFetch('/api/setup-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      });

      // The Clerk account was just created — establish the session.
      const email = res?.user?.email;
      try {
        if (!email) throw new Error('missing email');
        await login(email, password);
      } catch {
        toast.success('Account setup complete! Please sign in.');
        setTimeout(() => { window.location.href = '/login'; }, 1000);
        return;
      }

      toast.success('Account setup complete! Redirecting...');
      setTimeout(() => {
         window.location.href = '/dashboard-redirect';
      }, 500);
    } catch (err: any) {
      toast.error(err.message || 'Failed to setup account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-center h-screen bg-[#FAFAFA]">
      <div className="max-w-md w-full">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-black flex items-center justify-center mb-4">
            <Logo className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-black font-display tracking-tight text-[#0A0A0A]">Setup Your Account</h1>
          <p className="text-xs font-bold text-[#6B7280] uppercase tracking-widest mt-1">Echotrack Registration</p>
        </div>
        
        <Card className="p-5 sm:p-8 bg-white">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <Input 
                 label="Create Password" 
                 type="password" 
                 value={password} 
                 onChange={setPassword} 
                 required 
                 minLength={8}
              />
              <Input 
                 label="Confirm Password" 
                 type="password" 
                 value={confirmPassword} 
                 onChange={setConfirmPassword} 
                 required 
                 minLength={8}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
               {loading ? 'Saving...' : 'Set Password and Login'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
