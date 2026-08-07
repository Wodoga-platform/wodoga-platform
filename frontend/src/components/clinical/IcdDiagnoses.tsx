'use client';
/**
 * Wodoga Platform — ICD-10 diagnoses (typeahead + list).
 * Path: frontend/src/components/clinical/IcdDiagnoses.tsx
 *
 * Search the loaded ICD-10 set, add a coded diagnosis, and see the active
 * problem list. Laterality warnings from the API surface as a toast.
 * Uses the app's design tokens + form classes.
 *
 * Usage:  <IcdDiagnoses patientId={p.id} />
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Plus, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button, Spinner } from '@/components/ui';
import { clinicalService, type Icd10Code } from '@/services/clinical';

export function IcdDiagnoses({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<Icd10Code | null>(null);
  const [rank, setRank] = useState(2);

  const { data: diagnoses } = useQuery({
    queryKey: ['diagnoses', patientId],
    queryFn: () => clinicalService.listDiagnoses(patientId),
  });

  const { data: results, isFetching } = useQuery({
    queryKey: ['icd-search', term],
    queryFn: () => clinicalService.searchIcd(term),
    enabled: term.trim().length >= 2,
  });

  const addMut = useMutation({
    mutationFn: () =>
      clinicalService.addDiagnosis(patientId, { icd10_code: picked!.code, rank }),
    onSuccess: (res: { warnings?: string[] }) => {
      (res.warnings ?? []).forEach((w) => toast(w, { icon: '⚠️', duration: 8000 }));
      toast.success(`Added ${picked!.code_dotted}`);
      setPicked(null); setTerm(''); setRank(2);
      qc.invalidateQueries({ queryKey: ['diagnoses', patientId] });
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not add diagnosis'),
  });

  const active = (diagnoses ?? []).filter((d) => !d.resolved_date);

  return (
    <div className="space-y-4">
      {/* Active problem list */}
      <div className="flex flex-wrap gap-2">
        {active.length === 0 && <p className="text-sm text-ink-3">No coded diagnoses yet.</p>}
        {active.map((d) => (
          <span key={d.id}
            className="inline-flex items-center gap-1.5 rounded border border-surface-border
                       bg-surface-2 px-2 py-1 text-sm">
            {d.rank === 1 && <Badge variant="green">primary</Badge>}
            <span className="font-mono text-ink">{d.code_dotted}</span>
            <span className="text-ink-2 truncate max-w-[18rem]">{d.description}</span>
          </span>
        ))}
      </div>

      {/* Search box */}
      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-ink-4" />
        <input
          value={term}
          onChange={(e) => { setTerm(e.target.value); setPicked(null); }}
          placeholder="Search ICD-10 by code or description (e.g. L97.5 or diabetes)"
          className="form-input pl-9"
        />
        {isFetching && <Spinner size="sm" className="absolute right-3 top-3" />}
      </div>

      {/* Results */}
      {term.trim().length >= 2 && results && results.length > 0 && !picked && (
        <div className="max-h-64 overflow-auto rounded border border-surface-border divide-y divide-surface-borderLt">
          {results.map((r) => (
            <button key={r.code} onClick={() => setPicked(r)}
              className="w-full text-left px-3 py-2 hover:bg-bg flex items-center gap-2 transition-colors">
              <span className="font-mono text-sm w-20 shrink-0 text-ink">{r.code_dotted}</span>
              <span className="text-sm text-ink-2 flex-1">{r.description}</span>
              {!r.billable && <Badge variant="gray">header</Badge>}
            </button>
          ))}
        </div>
      )}

      {/* Confirm add */}
      {picked && (
        <div className="rounded border border-forest-light/40 bg-forest-ghost p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-forest" />
            <span className="font-mono text-sm text-ink">{picked.code_dotted}</span>
            <span className="text-sm text-ink-2">{picked.description}</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-ink-3">Rank</label>
            <select value={rank} onChange={(e) => setRank(Number(e.target.value))}
              className="form-select w-auto">
              <option value={1}>1 — primary</option>
              {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            {rank === 1 && !picked.billable && (
              <span className="text-xs text-red">
                Header code can’t be primary — pick a more specific child code.
              </span>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" onClick={() => setPicked(null)}>Cancel</Button>
              <Button onClick={() => addMut.mutate()}
                disabled={addMut.isPending || (rank === 1 && !picked.billable)}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default IcdDiagnoses;
