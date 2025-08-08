import { CONFIG } from './constants.js';

export class Utils {
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static getRandomDelay() {
    const delay = Math.floor(Math.random() * (CONFIG.MAX_RANDOM_DELAY - CONFIG.MIN_RANDOM_DELAY + 5)) + CONFIG.MIN_RANDOM_DELAY;
    return this.sleep(delay);
  }

  static debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func.apply(this, args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  static throttle(func, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  static formatPlayerName(name) {
    if (!name) return 'Невідомий гравець';
    return String(name).replace(/\s*\[.*?\]/, '');
  }

  static truncateName(name) {
    if (!name) return 'Невідомий';
    return name.length > 16 ? name.substring(0, 16) + '...' : name;
  }
}