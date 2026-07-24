import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Logo } from '../../components/Logo';
import { Button, Input, Card } from '../../components/ui/Common';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    try {
      await login(email, password);
      navigate('/dashboard-redirect');
    } catch (err: any) {
      setErrorMsg(err.message || 'Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex">
      {/* Left — form */}
      <div className="flex-1 flex justify-center items-center px-6 py-12">
        <div className="w-full max-w-[420px]">
          <div className="flex flex-col items-center mb-10">
            <div className="w-14 h-14 rounded-2xl bg-black flex items-center justify-center mb-4 shadow-sm">
              <Logo className="w-9 h-9" />
            </div>
            <h1 className="text-3xl font-black font-display tracking-tight text-[#0A0A0A]">EchoTrack</h1>
            <p className="text-xs uppercase tracking-[0.2em] font-bold text-[#FF7A00] mt-2">KSP Dominion Group</p>
          </div>

          <Card className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm">
            <h2 className="text-xl font-bold text-[#0A0A0A] mb-1">Sign in to your account</h2>
            <p className="text-sm text-gray-500 mb-6">Welcome back. Enter your credentials to continue.</p>

            {errorMsg && (
              <div className="mb-5 p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-600 font-medium">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input label="Email" type="email" value={email} onChange={(v: string) => setEmail(v)} />
              <Input label="Password" type="password" value={password} onChange={(v: string) => setPassword(v)} />
              <Button type="submit" disabled={loading} className="w-full h-12 text-base mt-2">
                {loading ? 'Signing in…' : 'Sign In'}
              </Button>
            </form>
          </Card>

          <p className="mt-6 text-center text-sm text-gray-600">
            New student? <Link to="/signup" className="text-[#FF7A00] font-semibold hover:underline">Create your account</Link>
          </p>
          <p className="mt-8 text-center text-xs text-gray-400">Secured by KSP Dominion Group · AES-256 · Node Online</p>
        </div>
      </div>

      {/* Right — brand panel */}
      <div className="hidden lg:flex flex-1 bg-[#FF7A00] relative overflow-hidden items-center justify-center px-16">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
        <div className="relative max-w-md text-white">
          <h2 className="text-5xl font-black font-display tracking-tight leading-[1.05] mb-6">Track student progress, intelligently.</h2>
          <p className="text-lg text-white/90 leading-relaxed font-medium">
            A modern weekly reporting and engagement platform built for structured student success.
          </p>
          <div className="mt-10 flex items-center gap-3 text-white/80 text-sm">
            <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span className="font-semibold tracking-wide">Live · Secure · KSP Dominion Group</span>
          </div>
        </div>
      </div>
    </div>
  );
}
