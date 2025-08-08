import { CACHE_KEYS } from './constants.js';

export class StateManager {
  static saveState(data) {
    try {
      localStorage.setItem(CACHE_KEYS.GAME_STATE, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save state:', error);
    }
  }

  static loadState() {
    try {
      const savedState = localStorage.getItem(CACHE_KEYS.GAME_STATE);
      return savedState ? JSON.parse(savedState) : null;
    } catch (error) {
      console.error('Failed to load state:', error);
      return null;
    }
  }

  static clearState() {
    try {
      localStorage.removeItem(CACHE_KEYS.GAME_STATE);
    } catch (error) {
      console.error('Failed to clear state:', error);
    }
  }

  static getAccessKey() {
    return localStorage.getItem(CACHE_KEYS.ACCESS_KEY);
  }

  static setAccessKey(key) {
    localStorage.setItem(CACHE_KEYS.ACCESS_KEY, key);
  }

  static clearAccessKey() {
    localStorage.removeItem(CACHE_KEYS.ACCESS_KEY);
  }
}