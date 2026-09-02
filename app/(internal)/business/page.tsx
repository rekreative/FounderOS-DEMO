'use client';

import { useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, Plus, Save, Target, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Badge, SectionHead } from '@/components/terminal';
import { getInternalBusinessWorkspace, saveInternalBusinessWorkspace } from '@/lib/api/business';
import type {
  InternalBusinessProfile,
  InternalBusinessService,
  SaveInternalBusinessWorkspaceInput,
} from '@/lib/business';

type ProfileDraft = Omit<InternalBusinessProfile, 'updatedAt'>;
type ServiceDraft = Omit<InternalBusinessService, 'updatedAt'>;

const EMPTY_PROFILE: ProfileDraft = {
  displayName: 'REKREATIVE',
  description: '',
  ownerName: 'Kilian',
  timezone: 'Europe/Madrid',
  currency: 'EUR',
  monthlyRevenueTarget: 0,
  monthlyNewClientsMin: 0,
  monthlyNewClientsTarget: 0,
  monthlyNewClientsMax: 0,
  monthlyLeadsMin: 0,
  monthlyLeadsTarget: 0,
  monthlyLeadsMax: 0,
  monthlyAppointmentsTarget: 0,
  acquisitionChannels: [],
  tools: [],
  commercialPolicy: '',
};

function newService(sortOrder: number): ServiceDraft {
  return {
    id: `draft-${Date.now()}-${sortOrder}`,
    name: '',
    description: null,
    price: 0,
    billingType: 'one_off',
    allowTwoPayments: false,
    secondPaymentTrigger: null,
    active: true,
    sortOrder,
  };
}

const control =
  'min-h-11 w-full min-w-0 border border-os-border bg-os-surface px-3 py-2.5 text-base text-os-text outline-none transition-colors placeholder:text-os-dim focus:border-os-border-strong sm:text-[13px]';
const fieldLabel = 'mb-1.5 block break-words text-[10px] font-semibold uppercase tracking-[0.16em] text-os-dim sm:tracking-[0.18em]';

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <label className="min-w-0">
      <span className={fieldLabel}>{label}</span>
      <div className="relative">
        <input
          className={`${control} tabular-nums ${suffix ? 'pr-12' : ''}`}
          type="number"
          min="0"
          step="1"
          value={value}
          onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
        />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-os-dim">{suffix}</span>}
      </div>
    </label>
  );
}

export default function BusinessPage() {
  const [profile, setProfile] = useState<ProfileDraft>(EMPTY_PROFILE);
  const [services, setServices] = useState<ServiceDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    getInternalBusinessWorkspace()
      .then((workspace) => {
        if (!active) return;
        if (workspace.profile) {
          const { updatedAt: _updatedAt, ...savedProfile } = workspace.profile;
          setProfile(savedProfile);
          setConfigured(true);
        }
        setServices(workspace.services.map(({ updatedAt: _updatedAt, ...service }) => service));
      })
      .catch(() => {
        if (active) setFeedback({ tone: 'err', text: 'No se pudo cargar la configuración de REKREATIVE.' });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const activeServices = useMemo(() => services.filter((service) => service.active).length, [services]);

  function updateProfile<K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
    setFeedback(null);
  }

  function updateService(index: number, patch: Partial<ServiceDraft>) {
    setServices((current) => current.map((service, serviceIndex) => (serviceIndex === index ? { ...service, ...patch } : service)));
    setFeedback(null);
  }

  function removeUnsavedOrDeactivate(index: number) {
    setServices((current) => {
      const service = current[index];
      if (service.id.startsWith('draft-')) return current.filter((_, serviceIndex) => serviceIndex !== index);
      return current.map((item, serviceIndex) => (serviceIndex === index ? { ...item, active: false } : item));
    });
  }

  async function handleSave() {
    setSaving(true);
    setFeedback(null);
    try {
      const input: SaveInternalBusinessWorkspaceInput = {
        profile,
        services: services.map((service, index) => ({
          ...service,
          id: service.id.startsWith('draft-') ? undefined : service.id,
          sortOrder: index,
        })),
      };
      const workspace = await saveInternalBusinessWorkspace(input);
      if (!workspace.profile) throw new Error('profile not returned');
      const { updatedAt: _updatedAt, ...savedProfile } = workspace.profile;
      setProfile(savedProfile);
      setServices(workspace.services.map(({ updatedAt: _updatedAt, ...service }) => service));
      setConfigured(true);
      setFeedback({ tone: 'ok', text: 'Configuración guardada correctamente.' });
    } catch {
      setFeedback({ tone: 'err', text: 'No se pudo guardar. Revisa los campos e inténtalo de nuevo.' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="REKREATIVE OS / NEGOCIO" title="REKREATIVE" />
        <div className="h-56 animate-pulse border border-os-border bg-os-surface" />
        <div className="h-72 animate-pulse border border-os-border bg-os-surface" />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8 sm:space-y-7">
      <PageHeader
        eyebrow="REKREATIVE OS / NEGOCIO"
        title="REKREATIVE"
        rightWide
        right={
          <div className="flex w-full items-center justify-between gap-3 sm:justify-end">
            <Badge tone={configured ? 'ok' : 'warn'}>{configured ? 'Configurado' : 'Pendiente'}</Badge>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 border border-os-text bg-os-text px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-os-bg transition-opacity hover:opacity-80 disabled:cursor-wait disabled:opacity-50 sm:flex-none"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        }
      />

      {feedback && (
        <div className={`break-words border px-4 py-3 text-[12px] ${feedback.tone === 'ok' ? 'border-os-ok/40 bg-os-ok/5 text-os-ok' : 'border-os-err/40 bg-os-err/5 text-os-err'}`}>
          {feedback.text}
        </div>
      )}

      <section>
        <SectionHead label="Perfil del negocio" />
        <div className="grid min-w-0 overflow-hidden border border-os-border bg-os-surface lg:grid-cols-[minmax(0,1.45fr)_minmax(260px,0.55fr)]">
          <div className="min-w-0 space-y-5 border-b border-os-border p-4 sm:p-6 lg:border-b-0 lg:border-r">
            <label>
              <span className={fieldLabel}>Nombre</span>
              <input className={control} value={profile.displayName} onChange={(event) => updateProfile('displayName', event.target.value)} />
            </label>
            <label>
              <span className={fieldLabel}>Descripción y posicionamiento</span>
              <textarea
                className={`${control} min-h-32 resize-y leading-6 sm:min-h-40`}
                value={profile.description}
                onChange={(event) => updateProfile('description', event.target.value)}
                placeholder="Qué hace REKREATIVE, para quién y qué transformación ofrece."
              />
            </label>
          </div>
          <div className="grid min-w-0 content-start gap-5 p-4 sm:p-6">
            <div className="flex items-center gap-3 border-b border-os-border pb-4">
              <span className="grid h-10 w-10 place-items-center border border-os-border text-os-muted"><BriefcaseBusiness className="h-4 w-4" /></span>
              <div>
                <p className="text-sm font-semibold text-os-text">Operación interna</p>
                <p className="mt-0.5 text-[11px] text-os-dim">No se mezcla con clientes</p>
              </div>
            </div>
            <label>
              <span className={fieldLabel}>Responsable</span>
              <input className={control} value={profile.ownerName} onChange={(event) => updateProfile('ownerName', event.target.value)} />
            </label>
            <div className="grid grid-cols-1 gap-3 min-[390px]:grid-cols-[minmax(0,1fr)_112px] lg:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_112px]">
              <label>
                <span className={fieldLabel}>Zona horaria</span>
                <input className={control} value={profile.timezone} onChange={(event) => updateProfile('timezone', event.target.value)} />
              </label>
              <label>
                <span className={fieldLabel}>Moneda</span>
                <input className={control} maxLength={3} value={profile.currency} onChange={(event) => updateProfile('currency', event.target.value.toUpperCase())} />
              </label>
            </div>
          </div>
        </div>
      </section>

      <section>
        <SectionHead label="Objetivos mensuales" />
        <div className="grid min-w-0 gap-px overflow-hidden border border-os-border bg-os-border sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0 bg-os-surface p-4 sm:p-5">
            <Target className="mb-4 h-4 w-4 text-os-dim sm:mb-6" />
            <NumberField label="Facturación objetivo" value={profile.monthlyRevenueTarget} suffix="EUR" onChange={(value) => updateProfile('monthlyRevenueTarget', value)} />
          </div>
          <div className="min-w-0 space-y-3 bg-os-surface p-4 sm:p-5">
            <p className={fieldLabel}>Nuevos clientes</p>
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
              <NumberField label="Mín." value={profile.monthlyNewClientsMin} onChange={(value) => updateProfile('monthlyNewClientsMin', value)} />
              <NumberField label="Objetivo" value={profile.monthlyNewClientsTarget} onChange={(value) => updateProfile('monthlyNewClientsTarget', value)} />
              <NumberField label="Máx." value={profile.monthlyNewClientsMax} onChange={(value) => updateProfile('monthlyNewClientsMax', value)} />
            </div>
          </div>
          <div className="min-w-0 space-y-3 bg-os-surface p-4 sm:p-5">
            <p className={fieldLabel}>Leads</p>
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
              <NumberField label="Mín." value={profile.monthlyLeadsMin} onChange={(value) => updateProfile('monthlyLeadsMin', value)} />
              <NumberField label="Objetivo" value={profile.monthlyLeadsTarget} onChange={(value) => updateProfile('monthlyLeadsTarget', value)} />
              <NumberField label="Máx." value={profile.monthlyLeadsMax} onChange={(value) => updateProfile('monthlyLeadsMax', value)} />
            </div>
          </div>
          <div className="min-w-0 bg-os-surface p-4 sm:p-5">
            <Target className="mb-4 h-4 w-4 text-os-dim sm:mb-6" />
            <NumberField label="Citas objetivo" value={profile.monthlyAppointmentsTarget} onChange={(value) => updateProfile('monthlyAppointmentsTarget', value)} />
          </div>
        </div>
      </section>

      <section>
        <SectionHead label="Canales y herramientas" />
        <div className="grid min-w-0 gap-px overflow-hidden border border-os-border bg-os-border md:grid-cols-2">
          <label className="min-w-0 bg-os-surface p-4 sm:p-5">
            <span className={fieldLabel}>Canales de captación</span>
            <textarea
              className={`${control} min-h-[76px] resize-y leading-5`}
              value={profile.acquisitionChannels.join(', ')}
              onChange={(event) => updateProfile('acquisitionChannels', parseList(event.target.value))}
              placeholder="Meta Ads, Redes sociales, Llamadas en frío"
            />
            <span className="mt-2 block text-[10.5px] text-os-dim">Separa cada canal con una coma.</span>
          </label>
          <label className="min-w-0 bg-os-surface p-4 sm:p-5">
            <span className={fieldLabel}>Stack operativo</span>
            <textarea
              className={`${control} min-h-[76px] resize-y leading-5`}
              value={profile.tools.join(', ')}
              onChange={(event) => updateProfile('tools', parseList(event.target.value))}
              placeholder="Make, Meta, Google Sheets, Calendar, WhatsApp, Stripe"
            />
            <span className="mt-2 block text-[10.5px] text-os-dim">Solo herramientas realmente utilizadas.</span>
          </label>
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1"><SectionHead label="Servicios y precios" count={activeServices} /></div>
          <button
            type="button"
            onClick={() => setServices((current) => [...current, newService(current.length)])}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 border border-os-border bg-os-surface px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-os-muted hover:border-os-border-strong hover:text-os-text sm:w-auto"
          >
            <Plus className="h-3.5 w-3.5" /> Añadir servicio
          </button>
        </div>

        <div className="space-y-3">
          {services.length === 0 && (
            <button
              type="button"
              onClick={() => setServices([newService(0)])}
              className="w-full border border-dashed border-os-border bg-os-surface px-5 py-10 text-center text-sm text-os-dim hover:border-os-border-strong hover:text-os-text"
            >
              Aún no hay servicios. Añade el primero.
            </button>
          )}
          {services.map((service, index) => (
            <article key={service.id} className={`min-w-0 overflow-hidden border border-os-border bg-os-surface p-4 sm:p-5 xl:p-6 ${service.active ? '' : 'opacity-60'}`}>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 sm:gap-4 xl:grid-cols-[minmax(220px,1.2fr)_minmax(160px,0.7fr)_130px_150px_auto] xl:items-end">
                <label className="col-span-2 min-w-0 xl:col-span-1">
                  <span className={fieldLabel}>Servicio</span>
                  <input className={control} value={service.name} onChange={(event) => updateService(index, { name: event.target.value })} placeholder="Nombre del servicio" />
                </label>
                <label className="min-w-0">
                  <span className={fieldLabel}>Modalidad</span>
                  <select
                    className={control}
                    value={service.billingType}
                    onChange={(event) => {
                      const billingType = event.target.value as ServiceDraft['billingType'];
                      updateService(index, billingType === 'monthly' ? { billingType, allowTwoPayments: false, secondPaymentTrigger: null } : { billingType });
                    }}
                  >
                    <option value="one_off">Implantación</option>
                    <option value="monthly">Mensual</option>
                  </select>
                </label>
                <label className="min-w-0">
                  <span className={fieldLabel}>Precio</span>
                  <div className="relative">
                    <input className={`${control} pr-8 tabular-nums`} type="number" min="0" value={service.price} onChange={(event) => updateService(index, { price: Math.max(0, Number(event.target.value) || 0) })} />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-os-dim">€</span>
                  </div>
                </label>
                <label className="flex min-h-11 min-w-0 items-center gap-2 border border-os-border px-3 text-xs text-os-muted">
                  <input
                    type="checkbox"
                    checked={service.active}
                    onChange={(event) => updateService(index, { active: event.target.checked })}
                    className="accent-[var(--accent)]"
                  />
                  Servicio activo
                </label>
                <button type="button" onClick={() => removeUnsavedOrDeactivate(index)} className="grid h-11 w-11 place-items-center justify-self-end border border-os-border text-os-dim hover:border-os-err hover:text-os-err" aria-label={service.id.startsWith('draft-') ? 'Eliminar servicio' : 'Desactivar servicio'}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.8fr)]">
                <label className="min-w-0">
                  <span className={fieldLabel}>Descripción</span>
                  <textarea className={`${control} min-h-[76px] resize-y leading-5`} value={service.description ?? ''} onChange={(event) => updateService(index, { description: event.target.value || null })} placeholder="Qué incluye y qué se entrega" />
                </label>
                {service.billingType === 'one_off' ? (
                  <div className="min-w-0">
                    <label className="mb-2 flex items-center gap-2 text-xs text-os-muted">
                      <input
                        type="checkbox"
                        checked={service.allowTwoPayments}
                        onChange={(event) => updateService(index, { allowTwoPayments: event.target.checked, secondPaymentTrigger: event.target.checked ? service.secondPaymentTrigger : null })}
                        className="accent-[var(--accent)]"
                      />
                      Permitir dos pagos
                    </label>
                    {service.allowTwoPayments && (
                      <textarea className={`${control} min-h-[76px] resize-y leading-5`} value={service.secondPaymentTrigger ?? ''} onChange={(event) => updateService(index, { secondPaymentTrigger: event.target.value || null })} placeholder="Cuándo se cobra el segundo pago" />
                    )}
                  </div>
                ) : (
                  <div className="flex items-end text-[11px] text-os-dim">Facturación mensual por adelantado.</div>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section>
        <SectionHead label="Condiciones comerciales" />
        <label className="block min-w-0 overflow-hidden border border-os-border bg-os-surface p-4 sm:p-6">
          <span className={fieldLabel}>Política comercial y de cobro</span>
          <textarea
            className={`${control} min-h-32 resize-y leading-6`}
            value={profile.commercialPolicy}
            onChange={(event) => updateProfile('commercialPolicy', event.target.value)}
            placeholder="Define hitos de pago, alcance de la entrega y condiciones sin prometer resultados."
          />
          <p className="mt-3 text-[11px] leading-5 text-os-dim">Este texto documenta el acuerdo operativo. No debe prometer calidad de leads ni resultados publicitarios.</p>
        </label>
      </section>
    </div>
  );
}
