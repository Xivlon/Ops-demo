import type { UrgencyLevel, UrgencyConfig } from '../types';

export function calculateUrgency(pickupTime: string | null | undefined): UrgencyLevel {
  if (!pickupTime) return 'NORMAL';
  
  const now = new Date();
  const pickup = new Date(pickupTime);
  const diffMs = pickup.getTime() - now.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = diffMs / 3600000;
  
  // Failed: pickup time exceeded 1 hour ago
  if (diffHours < -1) return 'FAILED';
  
  // Overdue: pickup time has passed (within last hour)
  if (diffMinutes <= 0) return 'OVERDUE';
  
  // Critical: pickup within 10 minutes
  if (diffMinutes <= 10) return 'CRITICAL';
  
  // Warning: pickup within 30 minutes
  if (diffMinutes <= 30) return 'WARNING';
  
  return 'NORMAL';
}

export function getUrgencyConfig(level: UrgencyLevel): UrgencyConfig {
  const configs: Record<UrgencyLevel, UrgencyConfig> = {
    OVERDUE: {
      level: 'OVERDUE',
      label: 'Overdue',
      color: 'red',
      bgClass: 'bg-red-500/20',
      textClass: 'text-red-400'
    },
    CRITICAL: {
      level: 'CRITICAL',
      label: 'Critical',
      color: 'orange',
      bgClass: 'bg-orange-500/20',
      textClass: 'text-orange-400'
    },
    WARNING: {
      level: 'WARNING',
      label: 'Warning',
      color: 'yellow',
      bgClass: 'bg-yellow-500/20',
      textClass: 'text-yellow-400'
    },
    NORMAL: {
      level: 'NORMAL',
      label: '',
      color: 'slate',
      bgClass: 'bg-slate-500/10',
      textClass: 'text-slate-400'
    },
    FAILED: {
      level: 'FAILED',
      label: 'Failed',
      color: 'gray',
      bgClass: 'bg-gray-500/20',
      textClass: 'text-gray-400'
    }
  };
  
  return configs[level];
}

export function formatTimeRemaining(pickupTime: string | null | undefined): string {
  if (!pickupTime) return '';
  
  const now = new Date();
  const pickup = new Date(pickupTime);
  const diffMs = pickup.getTime() - now.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  
  if (diffMinutes < 0) {
    const overdueMinutes = Math.abs(diffMinutes);
    if (overdueMinutes < 60) return `${overdueMinutes}m overdue`;
    const overdueHours = Math.floor(overdueMinutes / 60);
    return `${overdueHours}h overdue`;
  }
  
  if (diffMinutes < 60) return `${diffMinutes}m`;
  if (diffHours < 24) return `${diffHours}h ${diffMinutes % 60}m`;
  return `${Math.floor(diffHours / 24)}d`;
}

export function shouldShowUrgency(status: string): boolean {
  // Only show urgency for orders that haven't been picked up yet
  return ['PENDING', 'ASSIGNED'].includes(status);
}
