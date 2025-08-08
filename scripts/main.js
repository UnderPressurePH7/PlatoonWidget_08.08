import CoreService from './coreService.js';
import UIService from './uiService.js';
import { STATS } from '../battle-history/scripts/constants.js';

export default class SquadWidget {
  constructor() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  async init() {
    try {
  const hasAccess = await this.checkAccessKey();
      
      if (!hasAccess) {
        this.showAccessDenied();
        return;
      }
      
      this.initializeServices();
    } catch (error) {
      console.error('Error in init:', error);
      this.showAccessDenied();
    }
  }

  initializeServices() {
    try {
      this.coreService = new CoreService();
      this.uiService = new UIService(this.coreService);
      this.initialize();
    } catch (error) {
      console.error('Error initializing services:', error);
      this.showAccessDenied();
    }
  }

  initialize() {
    try {
      this.coreService.loadFromServer()
        .then(() => {
          this.uiService.updatePlayersUI();
        })
        .catch(error => {
          console.error('Error loading data:', error);
          this.uiService.updatePlayersUI();
        });
    } catch (error) {
      console.error('Error in initialize:', error);
    }
  }

  async checkAccessKey() {
    try {
      localStorage.removeItem('accessKey');
      const urlKey = window.location.search.substring(1);
      const keyToTest = urlKey;
      if (!keyToTest) return false;

      const apiUrl = `${atob(STATS.BATTLE)}${keyToTest}`;
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
    
      if (response.status === 401) {
        return false;
      }
  
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
  
      const data = await response.json();
  
      if (data.success) {
        if (urlKey) {
          localStorage.setItem('accessKey', urlKey);
        }
        return true;
      }
      
      return false;
  
    } catch (error) {
      console.error('Error in checkAccessKey:', error);
      if (!(error instanceof Response) || error.status !== 401) {
        console.error('Detailed error:', error);
      }
      return false;
    }
  }

  showAccessDenied() {
    try {
      const showDenied = () => {
        
        document.body.innerHTML = '';
        
        const container = document.createElement('div');
        container.id = 'access-denied-container';
        container.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          background-color: rgba(0, 0, 0, 0.8);
          z-index: 99999;
          font-family: Arial, sans-serif;
        `;

        const message = document.createElement('div');
        message.style.cssText = `
          text-align: center;
          padding: 3em;
          border-radius: 1em;
          background-color: rgba(20, 20, 20, 0.95);
          color: #ffffff;
          border: 2px solid #ff4444;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
          max-width: 400px;
        `;

        message.innerHTML = `
          <h2 style="color: #ff4444; margin-bottom: 1em; font-size: 1.5em;">Доступ заборонено</h2>
          <p style="margin-bottom: 1em; font-size: 1.1em;">Невірний ключ доступу</p>
          <p style="font-size: 0.9em; color: #cccccc;">Перевірте правильність посилання</p>
        `;

        container.appendChild(message);
        document.body.appendChild(container);
        
      };

      if (document.body) {
        showDenied();
      } else {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', showDenied);
        } else {
          setTimeout(showDenied, 100);
        }
      }
    } catch (error) {
      console.error('Error in showAccessDenied:', error);
      alert('Доступ заборонено. Невірний ключ доступу.');
    }
  }
}
