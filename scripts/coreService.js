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
    this.loadFromServer();
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
      });

      this.socket.on('connect', () => {
        this.socket.emit('getStats', { key: accessKey }, (response) => {
          if (response.status === 200) {
            this.handleServerData(response.body);
          } else {
            console.error('Error getting initial stats:', response.body.message);
          }
        });
      });

      this.socket.on('statsUpdated', (data) => {
        this.handleServerData(data);
      });

      this.socket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
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
      if (data.BattleStats) {
        // Unwrap server payload from _id structure to widget's expected shape
        const normalized = {};
        Object.entries(data.BattleStats).forEach(([arenaId, battleWrapper]) => {
          // Handle both wrapped (_id structure) and unwrapped data
          const battle = (battleWrapper && typeof battleWrapper === 'object' && battleWrapper._id) 
            ? battleWrapper._id 
            : battleWrapper;
          
          const players = {};
          const rawPlayers = battle?.players || {};
          Object.entries(rawPlayers).forEach(([pid, playerWrapper]) => {
            // Handle both wrapped (_id structure) and unwrapped player data
            const p = (playerWrapper && typeof playerWrapper === 'object' && playerWrapper._id) 
              ? playerWrapper._id 
              : playerWrapper;
            
            const kills = (typeof p.kills === 'number') ? p.kills : (typeof p.frags === 'number' ? p.frags : 0);
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
        // Unwrap PlayerInfo from _id structure if needed
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
      this.clearCalculationCache();
      this.eventsCore.emit('statsUpdated');
      this.saveState();
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
    this.lastUpdateTime = null;
  }

  setupDebouncedMethods() {
    this.serverDataDebounced = Utils.debounce(this.serverData.bind(this), CONFIG.DEBOUNCE_DELAY);
    this.serverDataLoadOtherPlayersDebounced = Utils.debounce(this.serverDataLoadOtherPlayers.bind(this), CONFIG.DEBOUNCE_DELAY);
  }

  setupSDKListeners() {
    this.sdk.data.game.serverTime.watch(this.handleServerTime.bind(this));
    this.sdk.data.hangar.isInHangar.watch(this.handleHangarStatus.bind(this));
    this.sdk.data.hangar.vehicle.info.watch(this.handleHangarVehicle.bind(this));
    this.sdk.data.platoon.isInPlatoon.watch(this.handlePlatoonStatus.bind(this));
    this.sdk.data.battle.arena.watch(this.handleArena.bind(this));
    this.sdk.data.battle.period.watch(this.handlePeriod.bind(this));
    this.sdk.data.battle.isInBattle.watch(this.handleisInBattle.bind(this));
    this.sdk.data.battle.onDamage.watch(this.handleOnAnyDamage.bind(this));
    this.sdk.data.battle.onPlayerFeedback.watch(this.handlePlayerFeedback.bind(this));
    this.sdk.data.battle.onBattleResult.watch(this.handleBattleResult.bind(this));
  }

  isValidBattleState() {
    return this.curentArenaId && this.curentPlayerId;
  }

  clearCalculationCache() {
    this.calculationCache.clear();
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
    if (!this.BattleStats[arenaId]) {
      this.BattleStats[arenaId] = {
        startTime: Date.now(),
        duration: 0,
        win: -1,
        mapName: 'Unknown Map',
        players: {}
      };
    }

    if (!this.BattleStats[arenaId].players[playerId]) {
      this.BattleStats[arenaId].players[playerId] = {
        name: this.PlayersInfo[playerId] || 'Unknown Player',
        damage: 0,
        kills: 0,
        points: 0,
        vehicle: this.curentVehicle || 'Unknown Vehicle'
      };
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
    const playersIds = this.getPlayersIds();
    return playersIds.includes(this.curentPlayerId);
  }

  findBestAndWorstBattle() {
    const allBattles = Object.entries(this.BattleStats).map(([arenaId, battle]) => ({
      id: arenaId,
      ...battle
    }));

    if (!allBattles || allBattles.length === 0) {
      return { bestBattle: null, worstBattle: null };
    }

    const completedBattles = allBattles.filter(battle => battle.win !== -1);

    if (completedBattles.length === 0) {
      return { bestBattle: null, worstBattle: null };
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

      return {
        bestBattle: { battle: bestBattle, points: bestBattlePoints },
        worstBattle: { battle: worstBattle, points: worstBattlePoints }
      };
    } catch (error) {
      console.error('Error when searching for the worst/best battle:', error);
      return { bestBattle: null, worstBattle: null };
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

    const dataToSend = {
      key: accessKey,
      playerId: this.curentPlayerId,
      body: {
        // Format data according to server schema with _id wrapper
        BattleStats: Object.fromEntries(Object.entries(this.BattleStats || {}).map(([arenaId, battle]) => {
          const players = {};
          Object.entries(battle.players || {}).forEach(([pid, p]) => {
            players[pid] = {
              _id: {
                name: p.name || 'Unknown Player',
                damage: p.damage || 0,
                kills: p.kills || 0,
                frags: typeof p.kills === 'number' ? p.kills : (typeof p.frags === 'number' ? p.frags : 0),
                points: p.points || 0,
                vehicle: p.vehicle || 'Unknown Vehicle'
              }
            };
          });
          return [arenaId, { 
            _id: {
              startTime: battle.startTime || Date.now(),
              duration: battle.duration || 0,
              win: battle.win || -1,
              mapName: battle.mapName || 'Unknown Map',
              players
            }
          }];
        })),
        PlayerInfo: this.PlayersInfo,
      }
    };
    
    // Try WebSocket first with timeout fallback to REST
    if (this.socket && this.socket.connected) {
      let saveCallbackReceived = false;
      let fallbackUsed = false;
      
      this.socket.emit('updateStats', dataToSend, (response) => {
        if (!fallbackUsed) {
          saveCallbackReceived = true;
          if (response.status !== 202) {
            console.error('Error updating stats:', response.body?.message || 'Unknown error');
          }
        }
      });
      
      // Fallback to REST if no response in 3 seconds
      setTimeout(async () => {
        if (!saveCallbackReceived && !fallbackUsed) {
          fallbackUsed = true;
          await this.saveViaREST(dataToSend.body, accessKey);
        }
      }, 3000);
      
      return;
    }

    // Direct REST if WebSocket unavailable
    await this.saveViaREST(dataToSend.body, accessKey);
  }

  async saveViaREST(data, accessKey) {
    try {
      const url = `${atob(STATS.BATTLE)}${accessKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Player-ID': this.curentPlayerId || ''
        },
        body: JSON.stringify(data)
      });
      
      if (response.ok) {
        return true;
      } else {
        console.error('REST API error:', response.status, response.statusText);
        return false;
      }
    } catch (e) {
      console.error('REST API exception:', e);
      return false;
    }
  }

  async loadFromServer() {
    const accessKey = this.getAccessKey();
    if (!accessKey) return;

    if (this.socket && this.socket.connected) {
      this.socket.emit('getStats', { key: accessKey }, (response) => {
        if (response.status === 200) {
          this.handleServerData(response.body);
        } else {
          console.error('Error getting initial stats via socket:', response.body?.message || 'Unknown error');
        }
      });
      return;
    }

    // REST fallback
    try {
      const url = `${atob(STATS.BATTLE)}${accessKey}`;
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
      if (res.ok) {
        const body = await res.json();
        this.handleServerData({ success: true, ...body });
      }
    } catch (e) {
      console.error('REST fallback getStats failed:', e);
    }
  }

  async loadFromServerOtherPlayers() {
    const accessKey = this.getAccessKey();
    if (!accessKey) return;

    if (this.socket && this.socket.connected) {
      this.socket.emit('getOtherPlayersStats', { key: accessKey, playerId: this.curentPlayerId }, (response) => {
        if (response.status === 200) {
          this.handleServerData(response.body);
        } else {
          console.error('Error getting other players stats via socket:', response.body?.message || 'Unknown error');
        }
      });
      return;
    }

    // REST fallback
    try {
      const url = `${atob(STATS.BATTLE)}pid/${accessKey}`;
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json', 'X-Player-ID': this.curentPlayerId || '' } });
      if (res.ok) {
        const body = await res.json();
        this.handleServerData({ success: true, ...body });
      }
    } catch (e) {
      console.error('REST fallback getOtherPlayersStats failed:', e);
    }
  }

  async clearServerData() {
    const accessKey = this.getAccessKey();
    if (!accessKey || !this.socket || !this.socket.connected) {
      console.error('Socket not connected or access key not found for clearing data.');
      return;
    }
    this.socket.emit('clearStats', { key: accessKey }, (response) => {
      if (response.status === 200) {
        this.BattleStats = {};
        this.PlayersInfo = {};
        this.clearCalculationCache();
        this.eventsCore.emit('statsUpdated');
      } else {
        console.error('Error clearing data via socket:', response.body.message);
      }
    });
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
      if (this.isDataChanged(this.BattleStats, JSON.parse(oldStats))) {
        this.eventsCore.emit('statsUpdated');
        this.saveState();
      }
    } catch (error) {
      console.error('Error in serverData:', error);
    }
  }

  handlePlatoonStatus(isInPlatoon) {
    this.isInPlatoon = isInPlatoon;
    this.saveState();
  }

  async handleHangarStatus(isInHangar) {
    if (!isInHangar) return;
    
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

  handleHangarVehicle(hangareVehicleData) {
    if (!hangareVehicleData) return;
    this.curentVehicle = hangareVehicleData.localizedShortName || 'Unknown Vehicle';
  }

  handleArena(arenaData) {
    if (!arenaData) return;

    this.curentArenaId = this.sdk?.data?.battle?.arenaId?.value ?? null;

    if (this.curentArenaId == null) return;
    if (this.curentPlayerId == null) return;

    // Завжди ініціалізуємо статистику бою для поточного гравця
    this.initializeBattleStats(this.curentArenaId, this.curentPlayerId);

    this.BattleStats[this.curentArenaId].mapName = arenaData.localizedName || 'Unknown Map';
    this.BattleStats[this.curentArenaId].players[this.curentPlayerId].vehicle = this.curentVehicle;
    this.BattleStats[this.curentArenaId].players[this.curentPlayerId].name = this.sdk.data.player.name.value;

    // Додаємо гравця до PlayersInfo якщо його там немає
    if (!this.PlayersInfo[this.curentPlayerId]) {
      this.PlayersInfo[this.curentPlayerId] = this.sdk.data.player.name.value;
    }

    if (this.isExistsPlayerRecord()) {
      this.serverDataLoadOtherPlayersDebounced();
    }

    this.serverDataDebounced();
  }
   
  async handleisInBattle(isInBattle) {
    this.isInBattle = isInBattle;
    await Utils.getRandomDelay();
    // await this.refreshLocalData(); // TESTING
  }

  handlePeriod(period) {
    if (!period || !this.isValidBattleState()) return;

    if (period.tag == "PREBATTLE") {
      this.lastUpdateTime = Date.now();
      this.eventsCore.emit('statsUpdated');
    }
  }

  async handleServerTime(serverTime) {
    // No longer needed with websockets
  }

  handleOnAnyDamage(onDamageData) {
    // No longer needed with websockets
  }

  handlePlayerFeedback(feedback) {
    if (!feedback || !feedback.type) return;

    const handlers = {
      'damage': this.handlePlayerDamage.bind(this),
      'kill': this.handlePlayerKill.bind(this),
      'radioAssist': this.handleGenericPlayerEvent.bind(this),
      'trackAssist': this.handleGenericPlayerEvent.bind(this),
      'tanking': this.handleGenericPlayerEvent.bind(this),
      'receivedDamage': this.handleGenericPlayerEvent.bind(this),
      'targetVisibility': this.handleGenericPlayerEvent.bind(this),
      'detected': this.handleGenericPlayerEvent.bind(this),
      'spotted': this.handleGenericPlayerEvent.bind(this)
    };

    const handler = handlers[feedback.type];
    if (handler) {
      handler(feedback.data);
    }
  }

  handleGenericPlayerEvent(eventData) {
    if (!eventData || !this.isValidBattleState()) return;
    this.serverDataLoadOtherPlayersDebounced();
  }

  handlePlayerDamage(damageData) {
    if (!damageData || !this.isValidBattleState()) return;

    const arenaId = this.curentArenaId;
    const playerId = this.curentPlayerId;
    
    // Ініціалізуємо статистику якщо її немає
    this.initializeBattleStats(arenaId, playerId);
    
    this.BattleStats[arenaId].players[playerId].damage += damageData.damage;
    this.BattleStats[arenaId].players[playerId].points += damageData.damage * GAME_POINTS.POINTS_PER_DAMAGE;
    
    this.clearCalculationCache();
    this.serverDataDebounced();
  }

  handlePlayerKill(killData) {
    if (!killData || !this.isValidBattleState()) return;

    const arenaId = this.curentArenaId;
    const playerId = this.curentPlayerId;
    
    // Ініціалізуємо статистику якщо її немає
    this.initializeBattleStats(arenaId, playerId);
    
    this.BattleStats[arenaId].players[playerId].kills += 1;
    this.BattleStats[arenaId].players[playerId].points += GAME_POINTS.POINTS_PER_FRAG;
    
    this.clearCalculationCache();
    this.serverDataDebounced();
  }

  async handleBattleResult(result) {
    if (!result || !result.vehicles || !result.players) {
      console.error("Invalid battle result data");
      return;
    }

    const arenaId = result.arenaUniqueID;
    if (!arenaId) return;

    this.curentPlayerId = result.personal.avatar.accountDBID;
    
    // Ініціалізуємо статистику якщо її немає
    this.initializeBattleStats(arenaId, this.curentPlayerId);
    
    this.BattleStats[arenaId].duration = result.common.duration;

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
          playerStats.damage = vehicle.damageDealt;
          playerStats.kills = vehicle.kills;
          playerStats.points = vehicle.damageDealt + (vehicle.kills * GAME_POINTS.POINTS_PER_FRAG);
          break;
        }
      }
    }

    this.clearCalculationCache();
    await Utils.getRandomDelay();
    
    this.serverDataDebounced();
  }
}

export default CoreService;
