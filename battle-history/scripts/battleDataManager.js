import EventEmitter from './eventEmitter.js';
import { StateManager } from './stateManager.js';
import { GAME_POINTS, STATS } from './constants.js';
import { Utils } from './utils.js';

class BattleDataManager {
  constructor() {
    this.initializeState();
    this.filteredBattles = [];
    this.eventsHistory = new EventEmitter();
  }

  initializeState() {
    const savedState = StateManager.loadState();
    this.BattleStats = savedState?.BattleStats || {};
    this.PlayersInfo = savedState?.PlayersInfo || {};
  }

  saveState() {
    StateManager.saveState({
      BattleStats: this.BattleStats,
      PlayersInfo: this.PlayersInfo
    });
  }

  clearState() {
    StateManager.clearState();
    this.BattleStats = {};
    this.PlayersInfo = {};
  }


  getAccessKey() {
    return StateManager.getAccessKey();
  }

  getBattlesArray() {
    return Object.entries(this.BattleStats).map(([arenaId, battle]) => ({
      id: arenaId,
      ...battle
    }));
  }

  calculateBattleData(battle) {
    if (!battle) return { battlePoints: 0, battleDamage: 0, battleKills: 0 };

    let battlePoints = battle.win === 1 ? GAME_POINTS.POINTS_PER_TEAM_WIN : 0;
    let battleDamage = 0;
    let battleKills = 0;

    if (battle.players) {
      Object.values(battle.players).forEach(player => {
        battlePoints += player.points || 0;
        battleDamage += player.damage || 0;
        battleKills += player.kills || 0;
      });
    }

    return { battlePoints, battleDamage, battleKills };
  }

  calculatePlayerData(playerId) {
    let playerPoints = 0;
    let playerDamage = 0;
    let playerKills = 0;

    Object.values(this.BattleStats).forEach(battle => {
      const player = battle.players?.[playerId];
      if (player) {
        playerPoints += player.points || 0;
        playerDamage += player.damage || 0;
        playerKills += player.kills || 0;
      }
    });

    return { playerPoints, playerDamage, playerKills };
  }

  calculateTeamData() {
    let teamPoints = 0;
    let teamDamage = 0;
    let teamKills = 0;
    let wins = 0;
    const battles = Object.keys(this.BattleStats).length;

    Object.values(this.BattleStats).forEach(battle => {
      if (battle.win === 1) {
        teamPoints += GAME_POINTS.POINTS_PER_TEAM_WIN;
        wins++;
      }

      if (battle.players) {
        Object.values(battle.players).forEach(player => {
          teamPoints += player.points || 0;
          teamDamage += player.damage || 0;
          teamKills += player.kills || 0;
        });
      }
    });

    return { teamPoints, teamDamage, teamKills, wins, battles };
  }

  async makeServerRequest(url, options = {}) {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async saveToServer() {
    try {
      const accessKey = this.getAccessKey();
      if (!accessKey) {
        throw new Error('Access key not found');
      }

      const data = {
        BattleStats: this.BattleStats,
        PlayerInfo: Object.fromEntries(Object.entries(this.PlayersInfo || {}).map(([pid, nickname]) => [
          pid, 
          { _id: typeof nickname === 'string' ? nickname : (nickname._id || nickname.name || 'Unknown Player') }
        ]))
      };

      const response = await this.makeServerRequest(`${atob(STATS.BATTLE)}${accessKey}`, {
        method: 'POST',
        body: JSON.stringify(data)
      });

      if (!response.success) {
        throw new Error(response.message || 'Failed to save data');
      }

      return true;
    } catch (error) {
      console.error('Error saving data to server:', error);
      throw error;
    }
  }

  async loadFromServer() {
    try {
      const accessKey = this.getAccessKey();
      if (!accessKey) {
        throw new Error('Access key not found');
      }

      const data = await this.makeServerRequest(`${atob(STATS.BATTLE)}${accessKey}`, {
        method: 'GET'
      });

      if (data.success) {
        if (data.BattleStats) {
          const normalized = {};
          Object.entries(data.BattleStats).forEach(([arenaId, battleWrapper]) => {
            const battle = (battleWrapper && typeof battleWrapper === 'object' && battleWrapper._id) 
              ? battleWrapper._id 
              : battleWrapper;
            
            const players = {};
            const rawPlayers = battle?.players || {};
            Object.entries(rawPlayers).forEach(([pid, playerWrapper]) => {
              const p = (playerWrapper && typeof playerWrapper === 'object' && playerWrapper._id) 
                ? playerWrapper._id 
                : playerWrapper;
              
              const kills = typeof p.kills === 'number' ? p.kills : 0;
              const damage = typeof p.damage === 'number' ? p.damage : 0;
              const points = typeof p.points === 'number' ? p.points : (damage + kills * GAME_POINTS.POINTS_PER_FRAG);
              players[pid] = {
                name: p.name || this.PlayersInfo?.[pid] || 'Unknown Player',
                damage,
                kills,
                points,
                vehicle: p.vehicle || 'Unknown Vehicle'
              };
            });
            normalized[arenaId] = {
              startTime: battle.startTime || Date.now(),
              duration: battle.duration ?? 0,
              win: typeof battle.win === 'number' ? battle.win : -1,
              mapName: battle.mapName || 'Unknown Map',
              players
            };
          });
          this.BattleStats = normalized;
        }
        if (data.PlayerInfo) {
          const normalizedPlayerInfo = {};
          Object.entries(data.PlayerInfo).forEach(([playerId, playerWrapper]) => {
            if (typeof playerWrapper === 'object' && playerWrapper._id) {
              normalizedPlayerInfo[playerId] = playerWrapper._id;
            } else {
              normalizedPlayerInfo[playerId] = playerWrapper;
            }
          });
          this.PlayersInfo = normalizedPlayerInfo;
        }
      }

      return true;
    } catch (error) {
      console.error('Error loading data from server:', error);
      throw error;
    }
  }

  async clearServerData() {
    const accessKey = this.getAccessKey();
    if (!accessKey) {
      throw new Error('Access key not found');
    }
    await this.makeServerRequest(`${atob(STATS.BATTLE)}clear/${accessKey}`, {
      method: 'GET'
    });
    await this.refreshLocalData();
    this.eventsHistory.emit('historyCleared');
  }

  async deleteBattle(battleId) {
    try {
      const accessKey = this.getAccessKey();
      if (!accessKey) {
        throw new Error('Access key not found');
      }
      
      await this.makeServerRequest(`${atob(STATS.BATTLE)}${accessKey}/${battleId}`, {
        method: 'DELETE'
      });

      await this.refreshLocalData();

      this.eventsHistory.emit('battleDeleted', battleId);
      return true;
    } catch (error) {
      console.error('Error deleting battle:', error);
      return false;
    }
  }

  filterByMap(battles, map) {
    return battles.filter(battle => battle.mapName === map);
  }

  filterByVehicle(battles, vehicle) {
    return battles.filter(battle => 
      battle.players && Object.values(battle.players).some(player => 
        player.vehicle === vehicle
      )
    );
  }

  filterByResult(battles, result) {
    const resultMap = {
      victory: 1,
      defeat: 0,
      draw: 2,
      inBattle: -1
    };

    return battles.filter(battle => battle.win === resultMap[result]);
  }

  filterByDate(battles, date) {
    const filterDate = new Date(date);
    filterDate.setHours(0, 0, 0, 0);

    return battles.filter(battle => {
      if (!battle.startTime) return false;

      const battleDate = new Date(battle.startTime);
      battleDate.setHours(0, 0, 0, 0);

      return battleDate.getTime() === filterDate.getTime();
    });
  }

  filterByPlayer(battles, player) {
    return battles.filter(battle =>
      battle.players && Object.values(battle.players).some(p => 
        p.name === player
      )
    );
  }

  async applyFilters(filters) {
    let filteredBattles = this.getBattlesArray();

    const filterMethods = {
      map: this.filterByMap,
      vehicle: this.filterByVehicle,
      result: this.filterByResult,
      date: this.filterByDate,
      player: this.filterByPlayer
    };

    Object.entries(filters).forEach(([key, value]) => {
      if (value && filterMethods[key]) {
        filteredBattles = filterMethods[key].call(this, filteredBattles, value);
      }
    });

    this.filteredBattles = filteredBattles;
    this.eventsHistory.emit('filtersApplied', this.filteredBattles);

    return this.filteredBattles;
  }

  async exportData() {
    try {
      return JSON.stringify(this.BattleStats, null, 2);
    } catch (error) {
      console.error("Error exporting data:", error);
      return null;
    }
  }

  async importData(importedData) {
    try {
      if (!this.isValidImportData(importedData)) {
        console.error("Invalid data format for import");
        return false;
      }

      await this.loadFromServer();

      this.mergeImportedData(importedData);

      const saveSuccess = await this.saveToServer();
      if (!saveSuccess) {
        throw new Error('Failed to save data to server');
      }

      await this.refreshLocalData();
      this.eventsHistory.emit('dataImported', importedData);

      return true;
    } catch (error) {
      console.error("Error importing data:", error);
      return false;
    }
  }

  isValidImportData(data) {
    return data && typeof data === 'object';
  }

  mergeImportedData(importedData) {
    Object.entries(importedData).forEach(([arenaId, battleData]) => {
      if (!battleData || typeof battleData !== 'object') return;
      if (!this.validateBattleData(battleData)) return;

      if (this.BattleStats[arenaId]) {
        this.BattleStats[arenaId] = {
          ...this.BattleStats[arenaId],
          ...battleData,
          players: {
            ...this.BattleStats[arenaId].players,
            ...battleData.players
          }
        };
      } else {
        this.BattleStats[arenaId] = battleData;
      }
    });
  }

  async refreshLocalData() {
    this.clearState();
    await Utils.sleep(10);
    await this.loadFromServer();
    await Utils.sleep(10);
    this.saveState();
  }

  validateBattleData(battleData) {
    const requiredFields = ['startTime', 'duration', 'win', 'mapName', 'players'];

    if (!requiredFields.every(field => field in battleData)) {
      console.error('Missing required battle fields');
      return false;
    }

    if (typeof battleData.players !== 'object') {
      console.error('Invalid players data structure');
      return false;
    }

    return Object.entries(battleData.players).every(([playerId, playerData]) => {
      if (!this.validatePlayerData(playerData)) {
        console.error(`Invalid player data for ID: ${playerId}`);
        return false;
      }
      return true;
    });
  }

  validatePlayerData(playerData) {
    const requiredFields = ['name', 'damage', 'kills', 'points', 'vehicle'];
    const fieldTypes = {
      name: 'string',
      damage: 'number',
      kills: 'number',
      points: 'number',
      vehicle: 'string'
    };

    return requiredFields.every(field => {
      if (!(field in playerData)) {
        console.error(`Missing required player field: ${field}`);
        return false;
      }

      if (typeof playerData[field] !== fieldTypes[field]) {
        console.error(`Invalid type for player field ${field}`);
        return false;
      }

      return true;
    });
  }
}


export default BattleDataManager;
