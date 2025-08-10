import EventEmitter from '../battle-history/scripts/eventEmitter.js';
import { GAME_POINTS, STATS, CONFIG} from '../battle-history/scripts/constants.js';
import { StateManager } from '../battle-history/scripts/stateManager.js';
import { Utils } from '../battle-history/scripts/utils.js';

class CoreService {
  constructor() {
    this.initializeSDK();
    this.initializeState();
    this.initializeCache();
    this.setupSDKListeners();
    this.eventsCore = new EventEmitter();
    this.setupDebouncedMethods();
    this.initializeSocket();
    this.loadFromServer().then(() => {
      this.eventsCore.emit('statsUpdated');
    });
  }

  initializeSocket() {
    const accessKey = this.getAccessKey();
    if (!accessKey) {
      console.error('Access key not found, WebSocket not initialized.');
      return;
    }
    
    if (typeof io === 'undefined') {
      console.error('Socket.IO library not found!');
      return;
    }
    
    try {
      this.socket = io(atob(STATS.WEBSOCKET_URL), {
        query: { key: accessKey },
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 20000,
      });

      this.socket.on('connect', () => {
        this.socket.emit('getStats', { key: accessKey }, (response) => {
          if (response && response.status === 200) {
            this.handleServerData(response.body);
            this.clearCalculationCache();
            this.eventsCore.emit('statsUpdated');
            this.saveState();
          } else {
            console.error('Error getting initial stats:', response?.body?.message || 'Unknown error');
          }
        });
      });

      this.socket.on('statsUpdated', (data) => {
        if (data && data.key === accessKey) {
          this.socket.emit('getStats', { key: accessKey }, (response) => {
            if (response && response.status === 200) {
              this.handleServerData(response.body);
              this.clearCalculationCache();
              this.eventsCore.emit('statsUpdated');
              this.saveState();
            }
          });
        }
      });

      this.socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
      });

      this.socket.on('reconnect_failed', () => {
        console.error('Socket reconnection failed.');
      });

      this.socket.on('error', (error) => {
        console.error('Socket error:', error);
      });
    } catch (error) {
      console.error('WebSocket initialization error:', error);
    }
  }

  isDataChanged(newData, oldData) {
    return JSON.stringify(newData) !== JSON.stringify(oldData);
  }

  handleServerData(data) {
    if (data.success) {
      const battleStats = data.BattleStats;
      const playersInfo = data.PlayerInfo;
      
      if (battleStats) {
        const normalized = {};
        Object.entries(battleStats).forEach(([arenaId, battle]) => {
          const battleData = (battle && typeof battle === 'object' && battle._id) ? battle._id : battle;
          
          const players = {};
          const rawPlayers = battleData?.players || {};
          Object.entries(rawPlayers).forEach(([pid, playerData]) => {
            const p = (playerData && typeof playerData === 'object' && playerData._id) ? playerData._id : playerData;
            
            const kills = typeof p.kills === 'number' ? p.kills : 0;
            const damage = typeof p.damage === 'number' ? p.damage : 0;
            const points = typeof p.points === 'number' ? p.points : (damage + kills * GAME_POINTS.POINTS_PER_FRAG);

            const existingPlayer = this.BattleStats?.[arenaId]?.players?.[pid];
            if (existingPlayer) {
              players[pid] = {
                name: p.name || existingPlayer.name || this.PlayersInfo?.[pid] || 'Unknown Player',
                damage: Math.max(damage || 0, existingPlayer.damage || 0),
                kills: Math.max(kills || 0, existingPlayer.kills || 0),
                points: Math.max(points || 0, existingPlayer.points || 0),
                vehicle: p.vehicle || existingPlayer.vehicle || 'Unknown Vehicle'
              };
            } else {

              players[pid] = {
                name: p.name || this.PlayersInfo?.[pid] || 'Unknown Player',
                damage,
                kills,
                points,
                vehicle: p.vehicle || 'Unknown Vehicle'
              };
            }
          });

          const existingBattle = this.BattleStats?.[arenaId];
          
          const localDuration = existingBattle?.duration ?? 0;
          const serverDuration = battleData.duration ?? 0;
          const finalDuration = Math.max(localDuration, serverDuration);
          
          const localWin = existingBattle?.win ?? -1;
          const serverWin = typeof battleData.win === 'number' ? battleData.win : -1;
          const finalWin = serverWin !== -1 ? serverWin : localWin;
          
          normalized[arenaId] = {
            startTime: battleData.startTime || (existingBattle?.startTime) || Date.now(),
            duration: finalDuration,
            win: finalWin,
            mapName: battleData.mapName || (existingBattle?.mapName) || 'Unknown Map',
            players
          };
        });
        
        Object.entries(this.BattleStats || {}).forEach(([arenaId, localBattle]) => {
          if (!normalized[arenaId]) {
            normalized[arenaId] = localBattle;
          }
        });
        
        this.BattleStats = normalized;
      }
      
      if (playersInfo) {
        const normalizedPlayerInfo = {};
        Object.entries(playersInfo).forEach(([playerId, playerInfo]) => {
          if (typeof playerInfo === 'object' && playerInfo._id) {
            normalizedPlayerInfo[playerId] = playerInfo._id;
          } else if (typeof playerInfo === 'string') {
            normalizedPlayerInfo[playerId] = playerInfo;
          } else {
            normalizedPlayerInfo[playerId] = playerInfo;
          }
        });
        this.PlayersInfo = normalizedPlayerInfo;
      }

      this.clearBestWorstCache();
    }
  }


  initializeSDK() {
    try {
      this.sdk = new WotstatWidgetsSdk.WidgetSDK();
    } catch (error) {
      console.error('Failed to initialize SDK:', error);
      throw error;
    }
  }

  initializeState() {
    const savedState = StateManager.loadState();
    if (savedState) {
      this.BattleStats = savedState.BattleStats || {};
      this.PlayersInfo = savedState.PlayersInfo || {};
      this.curentPlayerId = savedState.curentPlayerId || null;
      this.curentArenaId = savedState.curentArenaId || null;
      this.curentVehicle = savedState.curentVehicle || null;
      this.isInPlatoon = savedState.isInPlatoon || false;
      this.isInBattle = savedState.isInBattle || false;
      this.needToAddPlayers = savedState.needToAddPlayers || true;
      this.lastUpdateTime = savedState.lastUpdateTime || null;
    } else {
      this.resetState();
    }
  }

  initializeCache() {
    this.calculationCache = new Map();
  }

  resetState() {
    this.BattleStats = {};
    this.PlayersInfo = {};
    this.curentPlayerId = this.sdk.data.player.id.value;
    this.curentArenaId = null;
    this.curentVehicle = null;
    this.isInPlatoon = false;
    this.isInBattle = false;
    this.needToAddPlayers = true;
    this.lastUpdateTime = null;
  }

  setupDebouncedMethods() {
    this.serverDataDebounced = Utils.debounce(this.serverData.bind(this), CONFIG.DEBOUNCE_DELAY);
    this.serverDataLoadOtherPlayersDebounced = Utils.debounce(this.serverDataLoadOtherPlayers.bind(this), CONFIG.DEBOUNCE_DELAY);
  }

  setupSDKListeners() {
    // this.sdk.data.game.serverTime.watch(this.handleServerTime.bind(this));
    this.sdk.data.hangar.isInHangar.watch(this.handleHangarStatus.bind(this));
    this.sdk.data.hangar.vehicle.info.watch(this.handleHangarVehicle.bind(this));
    this.sdk.data.platoon.isInPlatoon.watch(this.handlePlatoonStatus.bind(this));
    this.sdk.data.battle.arena.watch(this.handleArena.bind(this));
    this.sdk.data.battle.period.watch(this.handlePeriod.bind(this));
    this.sdk.data.battle.isInBattle.watch(this.handleisInBattle.bind(this));
    // this.sdk.data.battle.onDamage.watch(this.handleOnAnyDamage.bind(this));
    this.sdk.data.battle.onPlayerFeedback.watch(this.handlePlayerFeedback.bind(this));
    this.sdk.data.battle.onBattleResult.watch(this.handleBattleResult.bind(this));
  }

  isValidBattleState() {
    return this.curentArenaId && this.curentPlayerId;
  }

  clearCalculationCache() {
    this.calculationCache.clear();
  }

  // Очищаємо тільки кеш поточного бою, зберігаючи кеш найкращого/найгіршого
  clearCurrentBattleCache() {
    // Видаляємо тільки кеші поточного бою
    const keysToDelete = [];
    for (const key of this.calculationCache.keys()) {
      if (key.startsWith(`battle_${this.curentArenaId}`) || 
          key.startsWith(`player_`) || 
          key.startsWith('total_')) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.calculationCache.delete(key));
  }

  // Очищаємо кеш найкращого/найгіршого бою при зміні завершених боїв  
  clearBestWorstCache() {
    const keysToDelete = [];
    for (const key of this.calculationCache.keys()) {
      if (key.startsWith('bestWorst_')) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.calculationCache.delete(key));
  }

  saveState() {
    const state = {
      BattleStats: this.BattleStats,
      PlayersInfo: this.PlayersInfo,
      curentPlayerId: this.curentPlayerId,
      curentArenaId: this.curentArenaId,
      curentVehicle: this.curentVehicle,
      isInPlatoon: this.isInPlatoon
    };
    StateManager.saveState(state);
  }

  clearState() {
    StateManager.clearState();
    this.resetState();
    this.clearCalculationCache();
  }

  initializeBattleStats(arenaId, playerId) {
    let shouldUpdate = false;
    
    if (!this.BattleStats[arenaId]) {
      this.BattleStats[arenaId] = {
        startTime: Date.now(),
        duration: 0,
        win: -1,
        mapName: 'Unknown Map',
        players: {}
      };
      shouldUpdate = true;
    }

    if (!this.BattleStats[arenaId].players[playerId]) {
      if (!this.PlayersInfo[playerId] && playerId === this.curentPlayerId) {
        try {
          const playerName = this.sdk?.data?.player?.name?.value || 'Unknown Player';
          this.PlayersInfo[playerId] = playerName;
        } catch (error) {
          console.error('Error getting player name from SDK:', error);
          this.PlayersInfo[playerId] = 'Unknown Player';
        }
      }

      this.BattleStats[arenaId].players[playerId] = {
        name: this.PlayersInfo[playerId] || 'Unknown Player',
        damage: 0,
        kills: 0,
        points: 0,
        vehicle: this.curentVehicle || 'Unknown Vehicle'
      };
      shouldUpdate = true;
    }
    
    if (shouldUpdate) {
      this.eventsCore.emit('statsUpdated');
    }
  }

  getPlayer(id) {
    return this.PlayersInfo[id] || null;
  }

  getPlayersIds() {
    return Object.keys(this.PlayersInfo || {})
      .filter(key => !isNaN(key))
      .map(Number);
  }

  isExistsPlayerRecord() {
    // Перевіряємо напряму в PlayersInfo, щоб уникнути проблем з типами даних
    return this.curentPlayerId !== null && 
           this.curentPlayerId !== undefined && 
           this.PlayersInfo && 
           this.PlayersInfo.hasOwnProperty(String(this.curentPlayerId));
  }

  findBestAndWorstBattle() {
    // Створюємо ключ кешу базований на кількості та id боїв
    const battleIds = Object.keys(this.BattleStats).sort().join(',');
    const cacheKey = `bestWorst_${battleIds}_${Object.keys(this.BattleStats).length}`;
    
    if (this.calculationCache.has(cacheKey)) {
      return this.calculationCache.get(cacheKey);
    }

    const allBattles = Object.entries(this.BattleStats).map(([arenaId, battle]) => ({
      id: arenaId,
      ...battle
    }));

    if (!allBattles || allBattles.length === 0) {
      const result = { bestBattle: null, worstBattle: null };
      this.calculationCache.set(cacheKey, result);
      return result;
    }

    const completedBattles = allBattles.filter(battle => battle.win !== -1);

    if (completedBattles.length === 0) {
      const result = { bestBattle: null, worstBattle: null };
      this.calculationCache.set(cacheKey, result);
      return result;
    }

    try {
      let worstBattle = completedBattles[0];
      let bestBattle = completedBattles[0];
      let worstBattlePoints = this.calculateBattlePoints(worstBattle);
      let bestBattlePoints = worstBattlePoints;

      completedBattles.forEach(battle => {
        try {
          const battlePoints = this.calculateBattlePoints(battle);

          if (battlePoints < worstBattlePoints) {
            worstBattle = battle;
            worstBattlePoints = battlePoints;
          }

          if (battlePoints > bestBattlePoints) {
            bestBattle = battle;
            bestBattlePoints = battlePoints;
          }
        } catch (error) {
          console.error('Error in calculating battle data:', error, battle);
        }
      });

      const result = {
        bestBattle: { battle: bestBattle, points: bestBattlePoints },
        worstBattle: { battle: worstBattle, points: worstBattlePoints }
      };
      
      // Зберігаємо результат в кеші
      this.calculationCache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error('Error when searching for the worst/best battle:', error);
      const result = { bestBattle: null, worstBattle: null };
      this.calculationCache.set(cacheKey, result);
      return result;
    }
  }

  calculateBattlePoints(battle) {
    let battlePoints = 0;

    if (battle.win === 1) {
      battlePoints += GAME_POINTS.POINTS_PER_TEAM_WIN;
    }

    if (battle && battle.players) {
      Object.values(battle.players).forEach(player => {
        battlePoints += player.points || 0;
      });
    }

    return battlePoints;
  }

  calculateBattleData(arenaId = this.curentArenaId) {
    const cacheKey = `battle_${arenaId}`;
    
    if (this.calculationCache.has(cacheKey)) {
      return this.calculationCache.get(cacheKey);
    }

    let battlePoints = 0;
    let battleDamage = 0;
    let battleKills = 0;

    try {
      if (this.BattleStats[arenaId] && this.BattleStats[arenaId].players) {
        for (const playerId in this.BattleStats[arenaId].players) {
          const player = this.BattleStats[arenaId].players[playerId];
          battlePoints += player.points || 0;
          battleDamage += player.damage || 0;
          battleKills += player.kills || 0;
        }
      }
    } catch (error) {
      console.error('An error in the calculation of combat data:', error);
    }

    const result = { battlePoints, battleDamage, battleKills };
    this.calculationCache.set(cacheKey, result);
    return result;
  }

  calculatePlayerData(playerId) {
    const cacheKey = `player_${playerId}_${Object.keys(this.BattleStats).length}`;
    
    if (this.calculationCache.has(cacheKey)) {
      return this.calculationCache.get(cacheKey);
    }

    let playerPoints = 0;
    let playerDamage = 0;
    let playerKills = 0;

    try {
      for (const arenaId in this.BattleStats) {
        const player = this.BattleStats[arenaId].players[playerId];
        if (player) {
          playerPoints += player.points || 0;
          playerDamage += player.damage || 0;
          playerKills += player.kills || 0;
        }
      }
    } catch (error) {
      console.error('An error in the calculation of player data:', error);
    }

    const result = { playerPoints, playerDamage, playerKills };
    this.calculationCache.set(cacheKey, result);
    return result;
  }

  calculateTeamData() {
    const cacheKey = `team_${Object.keys(this.BattleStats).length}`;
    
    if (this.calculationCache.has(cacheKey)) {
      return this.calculationCache.get(cacheKey);
    }

    let teamPoints = 0;
    let teamDamage = 0;
    let teamKills = 0;
    let wins = 0;
    let battles = 0;

    try {
      for (const arenaId in this.BattleStats) {
        battles++;
        if (this.BattleStats[arenaId].win === 1) {
          teamPoints += GAME_POINTS.POINTS_PER_TEAM_WIN;
          wins++;
        }

        for (const playerId in this.BattleStats[arenaId].players) {
          const player = this.BattleStats[arenaId].players[playerId];
          teamPoints += player.points || 0;
          teamDamage += player.damage || 0;
          teamKills += player.kills || 0;
        }
      }
    } catch (error) {
      console.error('Error in calculating command data:', error);
    }

    const result = { teamPoints, teamDamage, teamKills, wins, battles };
    this.calculationCache.set(cacheKey, result);
    return result;
  }

  getAccessKey() {
    return StateManager.getAccessKey();
  }

  async saveToServer(retries = CONFIG.RETRY_ATTEMPTS) {
    const accessKey = this.getAccessKey();
    if (!accessKey) {
      console.error('Access key not found.');
      return;
    }

    const hasPlayerData = Object.values(this.BattleStats || {}).some(battle => 
      battle.players && Object.keys(battle.players).length > 0
    );

    const dataToSend = {
      key: accessKey,
      playerId: this.curentPlayerId,
      BattleStats: Object.fromEntries(Object.entries(this.BattleStats || {}).map(([arenaId, battle]) => {
        const players = {};
        Object.entries(battle.players || {}).forEach(([pid, p]) => {
          players[pid] = {
            name: p.name || 'Unknown Player',
            damage: p.damage || 0,
            kills: p.kills || 0,
            points: p.points || 0,
            vehicle: p.vehicle || 'Unknown Vehicle'
          };
        });
        return [arenaId, { 
          startTime: battle.startTime || Date.now(),
          duration: battle.duration || 0,
          win: battle.win !== undefined ? battle.win : -1,
          mapName: battle.mapName || 'Unknown Map',
          players
        }];
      })),
      PlayerInfo: Object.fromEntries(Object.entries(this.PlayersInfo || {}).map(([pid, nickname]) => [
        pid, 
        { _id: typeof nickname === 'string' ? nickname : (nickname._id || nickname.name || 'Unknown Player') }
      ]))
    };
    
    if (this.socket && this.socket.connected) {
      let saveCallbackReceived = false;
      let fallbackUsed = false;
      
      this.socket.emit('updateStats', dataToSend, (response) => {
        if (!fallbackUsed) {
          saveCallbackReceived = true;
          if (response && response.status === 202) {
          } else {
            console.error('Error updating stats via WebSocket:', response?.body?.message || 'Unknown error');
          }
        }
      });
      
      setTimeout(async () => {
        if (!saveCallbackReceived && !fallbackUsed) {
          fallbackUsed = true;
          await this.saveViaREST(dataToSend, accessKey);
        }
      }, 3000);
      
      return;
    }
    await this.saveViaREST(dataToSend, accessKey);
  }

  async saveViaREST(data, accessKey) {
    try {
      const response = await fetch(`${atob(STATS.BATTLE)}${accessKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Player-ID': this.curentPlayerId || ''
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message || 'Failed to save data');
      }
    } catch (error) {
      console.error('Error saving data via REST:', error);
      throw error;
    }
  }

  async loadFromServer() {
    const accessKey = this.getAccessKey();
    if (!accessKey) return;

    if (this.socket && this.socket.connected) {
      this.socket.emit('getStats', { key: accessKey }, (response) => {
        if (response && response.status === 200) {
          this.handleServerData(response.body);
          this.clearCalculationCache();
          this.eventsCore.emit('statsUpdated');
          this.saveState();
        } else {
          console.error('Error getting initial stats via socket:', response?.body?.message || 'Unknown error');
          this.loadViaREST(accessKey);
        }
      });
      return;
    }
    await this.loadViaREST(accessKey);
  }

  async loadViaREST(accessKey) {
    try {
      const res = await fetch(`${atob(STATS.BATTLE)}${accessKey}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Player-ID': this.curentPlayerId
        }
      });
      if (res.ok) {
        const body = await res.json();
        this.handleServerData({ success: true, ...body });
        this.clearCalculationCache();
        this.eventsCore.emit('statsUpdated');
        this.saveState();
      } else {
        console.error('REST API error:', res.status, res.statusText);
      }
    } catch (error) {
      console.error('Error loading from server via REST:', error);
    }
  }

  async loadFromServerOtherPlayers() {
    const accessKey = this.getAccessKey();
    if (!accessKey) return;

    if (this.socket && this.socket.connected) {
      this.socket.emit('getOtherPlayersStats', { key: accessKey, playerId: this.curentPlayerId }, (response) => {
        if (response && response.status === 200) {
          this.handleServerData(response.body);
          this.clearCalculationCache();
          this.eventsCore.emit('statsUpdated');
          this.saveState();
        } else {
          console.error('Error getting other players stats via socket:', response?.body?.message || 'Unknown error');
        }
      });
      return;
    }

    try {
      const res = await fetch(`${atob(STATS.BATTLE)}pid/${accessKey}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Player-ID': this.curentPlayerId || ''
        }
      });
      if (res.ok) {
        const body = await res.json();
        this.handleServerData({ success: true, ...body });
        this.clearCalculationCache();
        this.eventsCore.emit('statsUpdated');
        this.saveState();
      }
    } catch (e) {
      console.error('REST fallback getOtherPlayersStats failed:', e);
    }
  }

  async clearServerData() {
    const accessKey = this.getAccessKey();
    if (!accessKey) {
      console.error('Access key not found for clearing data.');
      return;
    }
    if (this.socket && this.socket.connected) {
      this.socket.emit('clearStats', { key: accessKey }, (response) => {
        if (response && response.status === 200) {
          this.BattleStats = {};
          this.PlayersInfo = {};
          this.clearCalculationCache();
          this.eventsCore.emit('statsUpdated');
        } else {
          console.error('Error clearing data via socket:', response?.body?.message || 'Unknown error');
        }
      });
      return;
    }

    try {
      const response = await fetch(`${atob(STATS.BATTLE)}clear/${accessKey}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Player-ID': this.curentPlayerId || ''
        }
      });

      if (!response.ok) {
        throw new Error(`Error clearing data: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.success) {
        this.BattleStats = {};
        this.PlayersInfo = {};
        this.clearCalculationCache();
        this.eventsCore.emit('statsUpdated');
      } else {
        throw new Error(data.message || 'Failed to clear data');
      }
    } catch (error) {
      console.error('Error clearing data on the server:', error);
      throw error;
    }
  }

  async refreshData() {
    try {
      await this.loadFromServer();
      this.eventsCore.emit('statsUpdated');
      this.saveState();
    } catch (error) {
      console.error('Error in refreshData:', error);
    }
  }

  async refreshLocalData() {
    this.clearState();
    await Utils.sleep(10);
    await this.loadFromServer();
    await Utils.sleep(10);
    this.eventsCore.emit('statsUpdated');
    this.saveState();
  } 

  async serverDataLoad() {
    try {
      await this.loadFromServer();
      this.eventsCore.emit('statsUpdated');
      await Utils.sleep(CONFIG.UI_UPDATE_DELAY);
      this.saveState();
    } catch (error) {
      console.error('Error in serverDataLoad:', error);
    }
  }

  async serverDataLoadOtherPlayers() {
    try {
      await this.loadFromServerOtherPlayers();
      await Utils.sleep(CONFIG.UI_UPDATE_DELAY);
      this.eventsCore.emit('statsUpdated');
      this.saveState();
    } catch (error) {
      console.error('Error in serverDataLoadOtherPlayers:', error);
    }
  }

  async serverDataSave() {
    try {
      await this.saveToServer();
    } catch (error) {
      console.error('Error in serverDataSave:', error);
    }
  }

  async serverData() {
    try {
      const oldStats = JSON.stringify(this.BattleStats);
      await this.saveToServer();
      this.eventsCore.emit('statsUpdated');
      if (this.isDataChanged(this.BattleStats, JSON.parse(oldStats))) {
        this.saveState();
      }
    } catch (error) {
      console.error('Error in serverData:', error);
    }
  }

  handlePlatoonStatus(isInPlatoon) {
    this.isInPlatoon = isInPlatoon;
    this.eventsCore.emit('statsUpdated');
    this.saveState();
  }

  async handleHangarStatus(isInHangar) {
    if (!isInHangar) return;

    if (this.needToAddPlayers) {
      await Utils.sleep(CONFIG.HANGAR_DELAY);
      const playersID = this.getPlayersIds();
      this.curentPlayerId = this.sdk.data.player.id.value;
      this.curentArenaId = null;

    if (this.curentPlayerId === null) return;
    if ((this.isInPlatoon && playersID.length > 3) || (!this.isInPlatoon && playersID.length >= 1)) {
      return;
    }

    this.PlayersInfo[this.curentPlayerId] = this.sdk.data.player.name.value;

    await Utils.getRandomDelay();
    this.serverDataDebounced();
  }
}

  handleHangarVehicle(hangareVehicleData) {
    if (!hangareVehicleData) return;
    this.curentVehicle = hangareVehicleData.localizedShortName || 'Unknown Vehicle';
  }

  handleArena(arenaData) {
    if (!arenaData) return;

    this.curentArenaId = this.sdk?.data?.battle?.arenaId?.value ?? null;

    if (this.curentArenaId == null) return;
    if (this.curentPlayerId == null) return;

    this.initializeBattleStats(this.curentArenaId, this.curentPlayerId);

    this.BattleStats[this.curentArenaId].mapName = arenaData.localizedName || 'Unknown Map';
    this.BattleStats[this.curentArenaId].players[this.curentPlayerId].vehicle = this.curentVehicle;
    this.BattleStats[this.curentArenaId].players[this.curentPlayerId].name = this.sdk.data.player.name.value;

    if (!this.PlayersInfo[this.curentPlayerId]) {
      this.PlayersInfo[this.curentPlayerId] = this.sdk.data.player.name.value;
    }
      this.clearCurrentBattleCache();
      if (this.isExistsPlayerRecord()) {
        this.serverDataDebounced();
      }
  }
   
  async handleisInBattle(isInBattle) {
    this.isInBattle = isInBattle;
    await Utils.getRandomDelay();
  }

  handlePeriod(period) {
    if (!period || !this.isValidBattleState()) return;

    if (period.tag == "PREBATTLE") {
      this.lastUpdateTime = Date.now();
      this.eventsCore.emit('statsUpdated');
    }
  }

  // async handleServerTime(serverTime) {
  // }

  // handleOnAnyDamage(onDamageData) {
  // }

  handlePlayerFeedback(feedback) {
    if (!feedback || !feedback.type) return;

    const handlers = {
      'damage': this.handlePlayerDamage.bind(this),
      'kill': this.handlePlayerKill.bind(this)
      // 'radioAssist': this.handleGenericPlayerEvent.bind(this),
      // 'trackAssist': this.handleGenericPlayerEvent.bind(this),
      // 'tanking': this.handleGenericPlayerEvent.bind(this),
      // 'receivedDamage': this.handleGenericPlayerEvent.bind(this),
      // 'targetVisibility': this.handleGenericPlayerEvent.bind(this),
      // 'detected': this.handleGenericPlayerEvent.bind(this),
      // 'spotted': this.handleGenericPlayerEvent.bind(this)
    };

    const handler = handlers[feedback.type];
    if (handler) {
      handler(feedback.data);
    }
  }

  // handleGenericPlayerEvent(eventData) {
  //   if (!eventData || !this.isValidBattleState()) return;
  //   this.serverDataLoadOtherPlayersDebounced();
  // }

  handlePlayerDamage(damageData) {
    if (!damageData || !this.isValidBattleState()) return;

    const arenaId = this.curentArenaId;
    const playerId = this.curentPlayerId;
    
    if (this.isExistsPlayerRecord()) {
      this.initializeBattleStats(arenaId, playerId);
      
      const currentDamage = this.BattleStats[arenaId].players[playerId].damage || 0;
      const newDamage = currentDamage + damageData.damage;
      
      this.BattleStats[arenaId].players[playerId].damage = newDamage;
      this.BattleStats[arenaId].players[playerId].points += damageData.damage * GAME_POINTS.POINTS_PER_DAMAGE;
      
      this.clearCalculationCache();
      this.serverDataDebounced();
    }
  }

  handlePlayerKill(killData) {
    if (!killData || !this.isValidBattleState()) return;

    const arenaId = this.curentArenaId;
    const playerId = this.curentPlayerId;
        
    if (this.isExistsPlayerRecord()) {
      this.initializeBattleStats(arenaId, playerId);
      
      const currentKills = this.BattleStats[arenaId].players[playerId].kills || 0;
      
      this.BattleStats[arenaId].players[playerId].kills = currentKills + 1;
      this.BattleStats[arenaId].players[playerId].points += GAME_POINTS.POINTS_PER_FRAG;
      
      this.clearCalculationCache();
      this.serverDataDebounced();
    }
  }

  async handleBattleResult(result) {
    if (!result || !result.vehicles || !result.players) {
      console.error("Invalid battle result data");
      return;
    }

    const arenaId = result.arenaUniqueID;
    if (!arenaId) return;

    this.curentPlayerId = result.personal.avatar.accountDBID;
    this.needToAddPlayers = false;
    
    if (!this.BattleStats[arenaId]) {
      console.error(`Arena ${arenaId} not found in BattleStats during battle result processing`);
      return;
    }
    
    this.BattleStats[arenaId].duration = result.common.duration;

    if (result.common.arenaTag) {
      this.BattleStats[arenaId].mapName = result.common.arenaTag;
    }

    const playerTeam = Number(result.players[this.curentPlayerId].team);
    const winnerTeam = Number(result.common.winnerTeam);

    if (playerTeam !== undefined && playerTeam !== 0 && winnerTeam !== undefined) {
      if (playerTeam === winnerTeam) {
        this.BattleStats[arenaId].win = 1;
      } else if (winnerTeam === 0) {
        this.BattleStats[arenaId].win = 2;
      } else {
        this.BattleStats[arenaId].win = 0;
      }
    }

    for (const vehicleId in result.vehicles) {
      const vehicles = result.vehicles[vehicleId];
      for (const vehicle of vehicles) {
        if (vehicle.accountDBID === this.curentPlayerId) {
          const playerStats = this.BattleStats[arenaId].players[this.curentPlayerId];
          if (playerStats) {
            playerStats.damage = vehicle.damageDealt;
            playerStats.kills = vehicle.kills;
            playerStats.points = vehicle.damageDealt + (vehicle.kills * GAME_POINTS.POINTS_PER_FRAG);
            
            if (vehicle.typeCompDescr || vehicle.vehicleName) {
              playerStats.vehicle = vehicle.vehicleName || vehicle.typeCompDescr || 'Unknown Vehicle';
            }
          }
          break;
        }
      }
    }

    this.clearBestWorstCache(); 
    await Utils.getRandomDelay();
    
    if (this.isExistsPlayerRecord()) {
      this.serverDataDebounced();
    }
  }
}

export default CoreService;
