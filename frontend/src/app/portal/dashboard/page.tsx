'use client';
/** Wodoga — Patient Portal Dashboard */
import { useState } from 'react';
import { Home, MessageSquare, Pill } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth.store';
import { portalService } from '@/services';
import { Badge, PageLoader, EmptyState, Button } from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { fmtDate, fmtTime, VISIT_TYPE_LABEL, cn } from '@/utils';

export default function PortalDashboard() {
  const { user, signOut } = useAuthStore();
  const qc = useQueryClient();
  const [msgOpen, setMsgOpen] = useState(false);
  const { register, handleSubmit, reset } = useForm();

  const { data: profile,   isLoading: pl } = useQuery({ queryKey: ['portal','profile'],  queryFn: portalService.myProfile  });
  const { data: visits }                   = useQuery({ queryKey: ['portal','visits'],   queryFn: portalService.myVisits    });
  const { data: meds }                     = useQuery({ queryKey: ['portal','meds'],     queryFn: portalService.myMeds      });
  const { data: vitals }                   = useQuery({ queryKey: ['portal','vitals'],   queryFn: portalService.myVitals    });
  const { data: carePlan }                 = useQuery({ queryKey: ['portal','careplan'], queryFn: portalService.myCarePlan  });
  const { data: messages }                 = useQuery({ queryKey: ['portal','messages'], queryFn: portalService.myMessages  });

  const sendMsg = useMutation({
    mutationFn: (body: { subject: string; body: string }) => portalService.sendMessage(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal', 'messages'] });
      toast.success('Message sent to your care team ✓');
      setMsgOpen(false);
      reset();
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail?.message || 'Could not send message.'),
  });

  if (pl) return <PageLoader />;

  const upcoming = visits?.upcoming || [];
  const latestVitals = vitals?.[0];
  const unread = messages?.filter((m: any) => !m.is_read).length || 0;

  return (
    <div className="min-h-screen bg-bg">
      {/* Portal header */}
      <header className="bg-forest px-6 py-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <svg width="30" height="30" viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect width="48" height="48" rx="12" fill="rgba(255,255,255,0.15)"/><path d="M10 15 L15.6 31.4 Q16.6 34.2 17.8 31.5 L22.9 20.1 Q24 17.8 25.1 20.1 L30.2 31.5 Q31.4 34.2 32.4 31.4 L38 15" stroke="#FFFFFF" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
          <div>
            <div className="font-display text-lg font-bold text-white">Wodoga</div>
            <div className="text-[10px] text-white/50 uppercase tracking-wider">Patient Portal</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-white/80">{user?.first_name} {user?.last_name}</div>
          <button onClick={signOut} className="text-xs text-white/60 hover:text-white border border-white/20 rounded px-3 py-1.5 transition-colors">Sign Out</button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-6">
        {/* Welcome */}
        <div className="bg-gradient-to-r from-forest to-forest-mid rounded-xl p-6 text-white mb-6">
          <div className="text-sm text-white/70 mb-1">Welcome back</div>
          <div className="font-display text-2xl font-semibold">{profile?.first_name} {profile?.last_name}</div>
          <div className="text-sm text-white/70 mt-1">
            {profile?.primary_diagnosis && <span>Diagnosis: {profile.primary_diagnosis}</span>}
          </div>
          <div className="flex gap-4 mt-4 text-sm text-white/80">
            {profile?.caregiver_name && <span>Caregiver: <strong className="text-white">{profile.caregiver_name}</strong></span>}
            {profile?.provider_name  && <span>Provider: <strong className="text-white">{profile.provider_name}</strong></span>}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Upcoming visits */}
          <div className="card">
            <div className="card-header"><div className="text-sm font-bold">Upcoming Visits</div></div>
            {upcoming.length === 0 ? <EmptyState icon={Home} title="No upcoming visits" /> : (
              <div className="divide-y divide-surface-borderLt">
                {upcoming.map((v: any) => (
                  <div key={v.id} className="px-5 py-3 flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-pale rounded-lg flex flex-col items-center justify-center flex-shrink-0">
                      <div className="text-[10px] text-blue font-bold uppercase">{fmtDate(v.visit_date).split(' ')[0]}</div>
                      <div className="text-base font-bold text-blue leading-tight">{new Date(v.visit_date + 'T00:00:00').getDate()}</div>
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{VISIT_TYPE_LABEL[v.visit_type] || v.visit_type}</div>
                      <div className="text-xs text-ink-3">{fmtDate(v.visit_date)}{v.visit_time && ` at ${fmtTime(v.visit_time)}`}</div>
                      {v.caregiver_name && <div className="text-xs text-ink-3">with {v.caregiver_name}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Medications */}
          <div className="card">
            <div className="card-header"><div className="text-sm font-bold">My Medications</div></div>
            {!meds?.length ? <EmptyState icon={Pill} title="No active medications" /> : (
              <div className="divide-y divide-surface-borderLt">
                {meds.map((m: any) => (
                  <div key={m.drug_name} className="px-5 py-3 flex items-start gap-2.5">
                    <div className="w-8 h-8 bg-purple-pale rounded flex items-center justify-center flex-shrink-0"><Pill size={14} className="text-purple" /></div>
                    <div>
                      <div className="text-sm font-bold">{m.drug_name} <span className="font-normal text-ink-3">{m.dosage}</span></div>
                      <div className="text-xs text-ink-3">{m.frequency}</div>
                      {m.instructions && <div className="text-xs text-ink-2 mt-0.5">{m.instructions}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Latest vitals */}
          {latestVitals && (
            <div className="card">
              <div className="card-header"><div className="text-sm font-bold">Latest Vitals</div><div className="text-xs text-ink-3">{fmtDate(latestVitals.recorded_at)}</div></div>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {latestVitals.bp_systolic && (
                  <div className="text-center p-3 bg-bg rounded border border-surface-border">
                    <div className="text-lg font-mono font-bold">{latestVitals.bp_systolic}/{latestVitals.bp_diastolic}</div>
                    <div className="text-[10px] text-ink-3 uppercase mt-1">Blood Pressure</div>
                  </div>
                )}
                {latestVitals.heart_rate && (
                  <div className="text-center p-3 bg-bg rounded border border-surface-border">
                    <div className="text-lg font-mono font-bold">{latestVitals.heart_rate}</div>
                    <div className="text-[10px] text-ink-3 uppercase mt-1">Heart Rate</div>
                  </div>
                )}
                {latestVitals.oxygen_saturation && (
                  <div className="text-center p-3 bg-bg rounded border border-surface-border">
                    <div className="text-lg font-mono font-bold">{latestVitals.oxygen_saturation}%</div>
                    <div className="text-[10px] text-ink-3 uppercase mt-1">O₂ Sat</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="card">
            <div className="card-header">
              <div className="text-sm font-bold">Messages from Care Team</div>
              <div className="flex items-center gap-2">
                {unread > 0 && <Badge variant="red">{unread} new</Badge>}
                <Button size="xs" variant="primary" onClick={() => setMsgOpen(true)}>Message Care Team</Button>
              </div>
            </div>
            {!messages?.length ? <EmptyState icon={MessageSquare} title="No messages" /> : (
              <div className="divide-y divide-surface-borderLt">
                {messages.slice(0, 4).map((m: any) => (
                  <div key={m.id} className={cn('px-5 py-3', !m.is_read && 'bg-forest-ghost/20')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className={cn('text-sm', !m.is_read ? 'font-bold' : 'font-medium')}>{m.subject}</div>
                      {!m.is_read && <div className="w-2 h-2 rounded-full bg-forest flex-shrink-0 mt-1.5" />}
                    </div>
                    <div className="text-xs text-ink-3 mt-0.5">From: {m.sender_name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Care plan */}
          {carePlan && (
            <div className="card col-span-2">
              <div className="card-header"><div className="text-sm font-bold">My Care Plan</div><Badge variant="green">Active</Badge></div>
              <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div><div className="form-label">Diagnosis</div><div className="text-sm font-medium">{carePlan.primary_diagnosis}</div></div>
                <div><div className="form-label">Visit Frequency</div><div className="text-sm font-medium">{carePlan.visit_frequency}</div></div>
                <div><div className="form-label">Physician</div><div className="text-sm font-medium">{carePlan.ordering_physician}</div></div>
              </div>
              {carePlan.goals && (
                <div className="px-5 pb-5">
                  <div className="form-label mb-2">My Goals</div>
                  <div className="text-sm text-ink-2 bg-bg rounded p-3 border border-surface-border whitespace-pre-line leading-relaxed">
                    {carePlan.goals}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Compose message modal */}
      <Modal open={msgOpen} onClose={() => { setMsgOpen(false); reset(); }}
        title="Message Your Care Team"
        subtitle="Your message goes securely to your assigned provider"
        footer={
          <ModalFooter>
            <Button variant="secondary" onClick={() => { setMsgOpen(false); reset(); }}>Cancel</Button>
            <Button variant="primary" loading={sendMsg.isPending}
              onClick={handleSubmit((d: any) => sendMsg.mutate(d))}>Send Message</Button>
          </ModalFooter>
        }>
        <div className="space-y-3">
          <div>
            <label className="form-label">Subject</label>
            <input className="form-input" placeholder="What is your message about?" {...register('subject', { required: true })} />
          </div>
          <div>
            <label className="form-label">Message</label>
            <textarea className="form-textarea min-h-[120px]" placeholder="Type your message here..." {...register('body', { required: true })} />
          </div>
          <div className="text-xs text-ink-3 bg-bg rounded p-3 border border-surface-borderLt">
            This message is private and secure. For medical emergencies, call 911 — do not use this message system.
          </div>
        </div>
      </Modal>
    </div>
  );
}
