export type BusinessBillingType = 'one_off' | 'monthly';

export type InternalBusinessProfile = {
  displayName: string;
  description: string;
  ownerName: string;
  timezone: string;
  currency: string;
  monthlyRevenueTarget: number;
  monthlyNewClientsMin: number;
  monthlyNewClientsTarget: number;
  monthlyNewClientsMax: number;
  monthlyLeadsMin: number;
  monthlyLeadsTarget: number;
  monthlyLeadsMax: number;
  monthlyAppointmentsTarget: number;
  acquisitionChannels: string[];
  tools: string[];
  commercialPolicy: string;
  updatedAt: string;
};

export type InternalBusinessService = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  billingType: BusinessBillingType;
  allowTwoPayments: boolean;
  secondPaymentTrigger: string | null;
  active: boolean;
  sortOrder: number;
  updatedAt: string;
};

export type InternalBusinessWorkspace = {
  profile: InternalBusinessProfile | null;
  services: InternalBusinessService[];
};

export type SaveInternalBusinessWorkspaceInput = {
  profile: Omit<InternalBusinessProfile, 'updatedAt'>;
  services: Array<Omit<InternalBusinessService, 'id' | 'updatedAt'> & { id?: string }>;
};
