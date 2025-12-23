/**
 * Portfolio data models for unified gold holdings view
 */

export type PortfolioStatus = 'healthy' | 'degraded' | 'offline';
export type VenueStatus = 'healthy' | 'degraded' | 'offline';

export interface TokenHolding {
  symbol: string;
  balance: number;
  gramsEquivalent: number;
  lastUpdated: Date;
}

export interface VenueHolding {
  venueId: string;
  venueName: string;
  holdings: TokenHolding[];
  status: VenueStatus;
}

export interface Portfolio {
  totalGrams: number;
  venues: VenueHolding[];
  lastUpdated: Date;
  status: PortfolioStatus;
}