import { useMemo, useState } from 'react';
import { useDashboard } from '../store/useDashboard';
import { Panel, StatCard, DataTable, Chip, SectionHeading } from '../components/ui';
import { Search, Filter, Download, AlertTriangle, UserCheck, Building2, Calendar, MapPin, FileText, ChevronDown } from 'lucide-react';
import { requestExport } from '../lib/exportGate';
import { getSession } from '../lib/auth';
import type { PCOAnalysis, PCOCompanySummary } from '../types';

export function PCOCorner() {
  const pcoRecords = useDashboard((state) => state.pcoRecords);
  const pcoAnalysis = useDashboard((state) => state.pcoAnalysis);
  const loading = useDashboard((state) => state.loading);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'New' | 'Renewal'>('all');
  const [filterCategory, setFilterCategory] = useState<'all' | 'Category A' | 'Category B'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'Active' | 'Expiring' | 'Expired' | 'Unknown'>('all');
  const [sortConfig, setSortConfig] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'pco', dir: 'asc' });
  const [activeTab, setActiveTab] = useState<'pcos' | 'crossref' | 'expiring'>('pcos');
  const [unmatchedPage, setUnmatchedPage] = useState(1);
  const unmatchedPageSize = 100;

  if (loading || !pcoAnalysis) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-3 border-emerald-600 border-t-transparent" />
      </div>
    );
  }

  const { byPCO, crossReferences, unmatchedPCOs, expiringSoon, totals } = pcoAnalysis;

  const pcoRecordByEstablishment = useMemo(() => {
    const map = new Map<string, { address: string; natureOfBusiness: string }>();
    for (const record of pcoRecords) {
      const key = record.establishment?.trim().toLowerCase();
      if (!key) continue;
      const current = map.get(key) ?? { address: '', natureOfBusiness: '' };
      if (!current.address && record.address) current.address = record.address;
      if (!current.natureOfBusiness && record.natureOfBusiness) current.natureOfBusiness = record.natureOfBusiness;
      map.set(key, current);
    }
    return map;
  }, [pcoRecords]);

  const uniqueEstablishments = (pco: PCOCompanySummary) => {
    const seen = new Set<string>();
    return pco.establishments.filter((entry) => {
      const key = `${entry.establishment}|${entry.address}`.trim().toLowerCase();
      if (!entry.establishment || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  // Summary Cards
  const summaryCards = [
    { label: 'Total PCO Records', value: totals.pcoRecords.toLocaleString(), icon: FileText, accent: 'sky' as const },
    { label: 'Unique PCOs', value: totals.uniquePCOs.toLocaleString(), icon: UserCheck, accent: 'emerald' as const },
    { label: 'Establishments', value: totals.uniqueEstablishments.toLocaleString(), icon: Building2, accent: 'amber' as const },
    { label: 'New Accreditations', value: totals.newAccreditations.toLocaleString(), icon: Calendar, accent: 'violet' as const },
    { label: 'Renewals', value: totals.renewals.toLocaleString(), icon: Calendar, accent: 'rose' as const },
    { label: 'Expiring Soon (90d)', value: expiringSoon.length.toLocaleString(), icon: AlertTriangle, accent: 'rose' as const },
  ];

  // Filtered & sorted PCO list
  const filteredPCOs = useMemo(() => {
    let result = byPCO;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(p =>
        p.pco.toLowerCase().includes(q) ||
        p.evaluator.toLowerCase().includes(q) ||
        p.establishments.some(e => e.establishment.toLowerCase().includes(q)) ||
        p.industries.some(i => i.toLowerCase().includes(q))
      );
    }

    if (filterType !== 'all') {
      // Filter by establishment type
      result = result.filter(p => p.establishments.some(e => e.type === filterType));
    }

    if (filterCategory !== 'all') {
      result = result.filter(p => p.establishments.some(e => e.category === filterCategory));
    }

    // Sort
    result = [...result].sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sortConfig.key] ?? '';
      const bVal = (b as unknown as Record<string, unknown>)[sortConfig.key] ?? '';
      const dir = sortConfig.dir === 'asc' ? 1 : -1;
      if (typeof aVal === 'number' && typeof bVal === 'number') return (aVal - bVal) * dir;
      return String(aVal).localeCompare(String(bVal)) * dir;
    });

    return result;
  }, [byPCO, search, filterType, filterCategory, sortConfig]);

  // Filtered cross-references
  const filteredCrossRefs = useMemo(() => {
    let result = crossReferences;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(c =>
        c.pco.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q) ||
        c.permitNo.toLowerCase().includes(q)
      );
    }

    if (filterStatus !== 'all') {
      result = result.filter(c => c.permitStatus === filterStatus);
    }

    return result;
  }, [crossReferences, search, filterStatus]);

  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc',
    }));
  };

  const getStatusChip = (status: string) => {
    const tones: Record<string, 'emerald' | 'amber' | 'rose' | 'slate' | 'sky' | 'violet'> = {
      Active: 'emerald',
      Approved: 'emerald',
      Expired: 'rose',
      Expiring: 'amber',
      Pending: 'amber',
      Unknown: 'slate',
    };
    return <Chip tone={tones[status] || 'slate'}>{status}</Chip>;
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return 'N/A';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const exportCSV = () => {
    if (!pcoAnalysis) return;
    const rows = [
      ['PCO', 'Establishment', 'Permit Type', 'Permit No', 'Permit Status', 'Permit Expiry', 'HW Count', 'Clearance Count', 'Match Confidence'],
      ...pcoAnalysis.crossReferences.map(cr => [
        cr.pco,
        cr.establishment,
        cr.permitType,
        cr.permitNo,
        cr.permitStatus,
        cr.permitExpiry || '',
        String(cr.hwRegistrations.length),
        String(cr.clearances.length),
        cr.matchConfidence,
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `pco-crossref-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  // PCO Directory Table
  const pcoColumns = [
    {
      key: 'pco',
      header: 'PCO Name',
      render: (pco: PCOCompanySummary) => <span className="font-medium">{pco.pco}</span>,
      sortValue: (pco: PCOCompanySummary) => pco.pco,
    },
    {
      key: 'evaluator',
      header: 'Evaluator',
      render: (pco: PCOCompanySummary) => pco.evaluator,
      sortValue: (pco: PCOCompanySummary) => pco.evaluator,
    },
    {
      key: 'establishments',
      header: 'Establishment / address',
      render: (pco: PCOCompanySummary) => {
        const list = uniqueEstablishments(pco);
        if (!list.length) return <span className="text-slate-600">—</span>;
        return (
          <div className="scroll-thin max-h-[92px] min-w-[220px] max-w-[320px] space-y-1.5 overflow-y-auto pr-1">
            {list.map((entry, index) => (
              <div key={`${entry.establishment}-${index}`}>
                <div className="truncate text-[11px] font-medium text-slate-200" title={entry.establishment}>{entry.establishment || '—'}</div>
                <div className="truncate text-[9.5px] text-slate-500" title={entry.address}>{entry.address || 'No address on file'}</div>
              </div>
            ))}
          </div>
        );
      },
    },
    {
      key: 'nature',
      header: 'Nature of business',
      render: (pco: PCOCompanySummary) => (
        pco.industries.length ? (
          <div className="flex max-w-[220px] flex-wrap gap-1">
            {pco.industries.slice(0, 6).map((industry) => (
              <span key={industry} className="rounded border border-white/[0.07] bg-white/[0.02] px-1.5 py-0.5 text-[9px] text-slate-400">{industry}</span>
            ))}
            {pco.industries.length > 6 && <span className="text-[9px] text-slate-600">+{pco.industries.length - 6}</span>}
          </div>
        ) : <span className="text-slate-600">—</span>
      ),
    },
    {
      key: 'totalRecords',
      header: 'Records',
      render: (pco: PCOCompanySummary) => pco.totalRecords.toLocaleString(),
      sortValue: (pco: PCOCompanySummary) => pco.totalRecords,
    },
    {
      key: 'newCount',
      header: 'New',
      render: (pco: PCOCompanySummary) => <Chip tone="sky">{pco.newCount}</Chip>,
      sortValue: (pco: PCOCompanySummary) => pco.newCount,
    },
    {
      key: 'renewalCount',
      header: 'Renewals',
      render: (pco: PCOCompanySummary) => <Chip tone="violet">{pco.renewalCount}</Chip>,
      sortValue: (pco: PCOCompanySummary) => pco.renewalCount,
    },
    {
      key: 'companies',
      header: 'Companies',
      render: (pco: PCOCompanySummary) => pco.companies,
      sortValue: (pco: PCOCompanySummary) => pco.companies,
    },
    {
      key: 'municipalities',
      header: 'Municipalities',
      render: (pco: PCOCompanySummary) => pco.municipalities.slice(0, 3).join(', ') + (pco.municipalities.length > 3 ? '...' : ''),
    },
    {
      key: 'industries',
      header: 'Industries',
      render: (pco: PCOCompanySummary) => pco.industries.slice(0, 2).join(', ') + (pco.industries.length > 2 ? '...' : ''),
    },
  ];

  // Cross-Reference Table
  const crossRefColumns = [
    {
      key: 'pco',
      header: 'PCO',
      render: (cr: typeof crossReferences[0]) => <span className="font-medium">{cr.pco}</span>,
    },
    {
      key: 'establishment',
      header: 'Establishment',
      render: (cr: typeof crossReferences[0]) => cr.establishment,
    },
    {
      key: 'permitType',
      header: 'Permit Type',
      render: (cr: typeof crossReferences[0]) => <Chip tone="sky">{cr.permitType}</Chip>,
    },
    {
      key: 'permitNo',
      header: 'Permit No.',
      render: (cr: typeof crossReferences[0]) => <code className="text-sm">{cr.permitNo}</code>,
    },
    {
      key: 'permitStatus',
      header: 'Permit Status',
      render: (cr: typeof crossReferences[0]) => getStatusChip(cr.permitStatus),
    },
    {
      key: 'permitExpiry',
      header: 'Permit Expiry',
      render: (cr: typeof crossReferences[0]) => formatDate(cr.permitExpiry),
    },
    {
      key: 'hwRegistrations',
      header: 'HW Registrations',
      render: (cr: typeof crossReferences[0]) => cr.hwRegistrations.length > 0 ? (
        <div className="space-y-1 text-xs">
          {cr.hwRegistrations.map((hw, idx) => (
            <div key={idx}>
              <code>{hw.hwGrNo}</code> - {getStatusChip(hw.hwStatus)}
              {hw.hwExpiry && ` (exp: ${formatDate(hw.hwExpiry)})`}
            </div>
          ))}
        </div>
      ) : <span className="text-slate-500">—</span>,
    },
    {
      key: 'clearances',
      header: 'Clearances',
      render: (cr: typeof crossReferences[0]) => cr.clearances.length > 0 ? (
        <div className="space-y-1 text-xs">
          {cr.clearances.map((cl, idx) => (
            <div key={idx}>
              <Chip tone="slate">{cl.type}</Chip> {cl.number} - {getStatusChip(cl.status)}
            </div>
          ))}
        </div>
      ) : <span className="text-slate-500">—</span>,
    },
    {
      key: 'matchConfidence',
      header: 'Match Confidence',
      render: (cr: typeof crossReferences[0]) => <Chip tone={cr.matchConfidence === 'high' ? 'emerald' : cr.matchConfidence === 'medium' ? 'amber' : 'slate'}>{cr.matchConfidence}</Chip>,
    },
  ];

  // Expiring Soon Table
  const expiringColumns = [
    {
      key: 'pco',
      header: 'PCO',
      render: (exp: typeof expiringSoon[0]) => <span className="font-medium">{exp.pco}</span>,
    },
    {
      key: 'establishment',
      header: 'Establishment',
      render: (exp: typeof expiringSoon[0]) => exp.establishment,
    },
    {
      key: 'type',
      header: 'Type',
      render: (exp: typeof expiringSoon[0]) => <Chip tone={exp.type === 'pco-accreditation' ? 'violet' : exp.type === 'permit' ? 'sky' : 'amber'}>{exp.type}</Chip>,
    },
    {
      key: 'expiryDate',
      header: 'Expiry Date',
      render: (exp: typeof expiringSoon[0]) => formatDate(exp.expiryDate),
    },
    {
      key: 'daysUntilExpiry',
      header: 'Days Left',
      render: (exp: typeof expiringSoon[0]) => (
        <Chip tone={exp.daysUntilExpiry <= 30 ? 'rose' : exp.daysUntilExpiry <= 60 ? 'amber' : 'emerald'}>
          {exp.daysUntilExpiry} days
        </Chip>
      ),
      sortValue: (exp: typeof expiringSoon[0]) => exp.daysUntilExpiry,
    },
  ];

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">PCO Corner</h1>
          <p className="text-slate-500 mt-1">
            Cross-reference analysis of Pollution Control Officers with permits, hazardous waste registrations, and clearances
          </p>
        </div>
        {getSession()?.role !== 'rd' && (
          <button
            type="button"
            onClick={() => requestExport(exportCSV)}
            className="btn btn-secondary gap-2 flex items-center"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {summaryCards.map((card, i) => {
            const Icon = card.icon;
            return (
              <StatCard
                key={i}
                label={card.label}
                value={card.value}
                icon={<Icon className="h-6 w-6" />}
                accent={card.accent}
              />
            );
          })}
      </div>

      {/* Filters */}
      <Panel className="border-slate-200">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center mb-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search PCO, evaluator, establishment, industry..."
              value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              className="input pl-10 w-full"
            />
          </div>
          <select
            value={filterType}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterType(e.target.value as 'all' | 'New' | 'Renewal')}
            className="input w-[160px]"
          >
            <option value="all">All Types</option>
            <option value="New">New</option>
            <option value="Renewal">Renewal</option>
          </select>
          <select
            value={filterCategory}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterCategory(e.target.value as 'all' | 'Category A' | 'Category B')}
            className="input w-[160px]"
          >
            <option value="all">All Categories</option>
            <option value="Category A">Category A</option>
            <option value="Category B">Category B</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterStatus(e.target.value as 'all' | 'Active' | 'Expiring' | 'Expired' | 'Unknown')}
            className="input w-[160px]"
          >
            <option value="all">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Expiring">Expiring</option>
            <option value="Expired">Expired</option>
            <option value="Unknown">Unknown</option>
          </select>
        </div>
      </Panel>

      {/* Tab Navigation */}
      <div className="flex border-b border-slate-200">
        {[
          { id: 'pcos', label: `PCO Directory (${filteredPCOs.length})` },
          { id: 'crossref', label: `Permit Cross-Ref (${filteredCrossRefs.length})` },
          { id: 'expiring', label: `Expiring Soon (${expiringSoon.length})` },
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'pcos' && (
        <Panel>
          <DataTable
            rows={filteredPCOs}
            columns={pcoColumns}
            rowKey={(pco) => pco.pco}
            initialSort={{ key: 'pco', direction: 'asc' }}
            pageSize={25}
            maxHeight="max-h-[620px]"
            empty={<div className="text-center py-8 text-slate-500">No PCOs match the current filters</div>}
          />
        </Panel>
      )}

      {activeTab === 'crossref' && (
        <Panel>
          <DataTable
            rows={filteredCrossRefs}
            columns={crossRefColumns}
            rowKey={(cr) => `${cr.pco}-${cr.permitNo}-${cr.establishment}`}
            pageSize={25}
            maxHeight="max-h-[620px]"
            empty={<div className="text-center py-8 text-slate-500">No cross-references match the current filters</div>}
          />
        </Panel>
      )}

      {activeTab === 'expiring' && (
        <Panel>
          <DataTable
            rows={expiringSoon}
            columns={expiringColumns}
            rowKey={(exp) => `${exp.pco}-${exp.type}-${exp.establishment}-${exp.expiryDate}`}
            initialSort={{ key: 'daysUntilExpiry', direction: 'asc' }}
            pageSize={25}
            maxHeight="max-h-[620px]"
            empty={<div className="text-center py-8 text-slate-500">No items expiring within 90 days</div>}
          />
        </Panel>
      )}

      {/* Unmatched PCOs Section */}
      {unmatchedPCOs.length > 0 && (
        <Panel className="border-amber-200">
          <SectionHeading
            eyebrow="Attention"
            title="Unmatched PCOs"
            description={unmatchedPCOs.length.toLocaleString()}
          />
          <p className="text-sm text-amber-700 mb-3">
            These PCO establishments have no matching permits, HW registrations, or clearances in the EMB database.
            They may need manual review or data reconciliation.
          </p>
          <DataTable
            rows={unmatchedPCOs.slice((unmatchedPage - 1) * unmatchedPageSize, unmatchedPage * unmatchedPageSize)}
            columns={[
              { key: 'pco', header: 'PCO', render: (u) => u.pco },
              { key: 'establishment', header: 'Establishment', render: (u) => u.establishment },
              { key: 'address', header: 'Address', render: (u) => {
                const detail = pcoRecordByEstablishment.get(u.establishment?.trim().toLowerCase() ?? '');
                return <span className="block max-w-[260px] truncate text-[10.5px] text-slate-500" title={detail?.address}>{detail?.address || '—'}</span>;
              } },
              { key: 'nature', header: 'Nature of business', render: (u) => {
                const detail = pcoRecordByEstablishment.get(u.establishment?.trim().toLowerCase() ?? '');
                return <span className="block max-w-[220px] truncate text-[10.5px] text-slate-500" title={detail?.natureOfBusiness}>{detail?.natureOfBusiness || '—'}</span>;
              } },
              { key: 'reason', header: 'Reason', render: (u) => <span className="text-amber-700">{u.reason}</span> },
            ]}
            rowKey={(u) => `${u.pco}-${u.establishment}`}
            empty={<div className="text-center py-8 text-slate-500">No unmatched PCOs</div>}
          />
          {unmatchedPCOs.length > unmatchedPageSize && (
            <div className="mt-3 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setUnmatchedPage(p => Math.max(1, p - 1))}
                disabled={unmatchedPage === 1}
                className="btn btn-secondary text-sm"
              >
                Previous
              </button>
              <span className="text-sm text-slate-600">
                Page {unmatchedPage} of {Math.ceil(unmatchedPCOs.length / unmatchedPageSize)} ({unmatchedPCOs.length.toLocaleString()} total)
              </span>
              <button
                type="button"
                onClick={() => setUnmatchedPage(p => Math.min(Math.ceil(unmatchedPCOs.length / unmatchedPageSize), p + 1))}
                disabled={unmatchedPage >= Math.ceil(unmatchedPCOs.length / unmatchedPageSize)}
                className="btn btn-secondary text-sm"
              >
                Next
              </button>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}