class ChartManager {
    constructor(dataManager) {
        this.dataManager = dataManager;
        this.charts = {};
    }

    initializeCharts() {
        try {
            this.createPerformanceChart();
            this.createWinRateChart();

            this.createSimplePlayerChart();
            this.createPlayerWinRateChart();

            this.createSimpleVehicleChart();
            this.createVehicleWinRateChart();
        } catch (error) {
            console.error('Error when initializing charts:', error);
        }
    }

    updatePerformanceCharts() {
        try {
            this.updatePerformanceChart();
            this.updateWinRateChart();
        } catch (error) {
            console.error('Error updating performance charts:', error);
        }
    }

    updatePlayerCharts() {
        try {
            this.updateSimplePlayerChart();
            this.updatePlayerWinRateChart();
        } catch (error) {
            console.error('Error when updating player charts:', error);
        }
    }

    updateVehicleCharts() {
        try {
            this.updateSimpleVehicleChart();
            this.updateVehicleWinRateChart();
        } catch (error) {
            console.error('Error updating equipment diagrams:', error);
        }
    }

    createPerformanceChart() {
        const ctx = document.getElementById('performance-chart')?.getContext('2d');
        if (!ctx) return;

        if (this.charts.performance) {
            this.charts.performance.destroy();
        }
        
        this.charts.performance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Середня шкода',
                        data: [],
                        borderColor: '#ff9c00',
                        backgroundColor: 'rgba(255, 156, 0, 0.2)',
                        tension: 0.3,
                        borderWidth: 2
                    },
                    {
                        label: 'Середні фраги',
                        data: [],
                        borderColor: '#4ee100',
                        backgroundColor: 'rgba(78, 225, 0, 0.2)',
                        tension: 0.3,
                        borderWidth: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Динаміка продуктивності',
                        color: '#fff'
                    },
                    legend: {
                        labels: {
                            color: '#ccc'
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            color: '#aaa'
                        },
                        grid: {
                            color: 'rgba(70, 70, 70, 0.2)'
                        }
                    },
                    y: {
                        ticks: {
                            color: '#aaa'
                        },
                        grid: {
                            color: 'rgba(70, 70, 70, 0.2)'
                        }
                    }
                }
            }
        });
        
        this.updatePerformanceChart();
    }

    updatePerformanceChart() {
        if (!this.charts.performance) return;
        
        const battles = this.dataManager.getBattlesArray();

        const sortedBattles = [...battles].sort((a, b) => 
            new Date(a.startTime || 0) - new Date(b.startTime || 0)
        );

        const battlesByDate = {};
        sortedBattles.forEach(battle => {
            if (!battle.startTime) return;
            
            const date = new Date(battle.startTime);
            const dateKey = date.toLocaleDateString();
            
            if (!battlesByDate[dateKey]) {
                battlesByDate[dateKey] = {
                    battles: 0,
                    damage: 0,
                    frags: 0
                };
            }
            
            const battleData = this.dataManager.calculateBattleData(battle);
            battlesByDate[dateKey].battles++;
            battlesByDate[dateKey].damage += battleData.battleDamage;
            battlesByDate[dateKey].frags += battleData.battleKills;
        });
        
        const dates = Object.keys(battlesByDate);
        const avgDamage = dates.map(date => {
            const data = battlesByDate[date];
            return data.damage / data.battles || 0;
        });
        const avgFrags = dates.map(date => {
            const data = battlesByDate[date];
            return data.frags / data.battles || 0;
        });
        
        this.charts.performance.data.labels = dates;
        this.charts.performance.data.datasets[0].data = avgDamage;
        this.charts.performance.data.datasets[1].data = avgFrags;
        this.charts.performance.update();
    }

    createWinRateChart() {
        const ctx = document.getElementById('win-rate-chart')?.getContext('2d');
        if (!ctx) return;

        if (this.charts.winRate) {
            this.charts.winRate.destroy();
        }
        
        this.charts.winRate = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Перемоги', 'Поразки', 'Нічиї'],
                datasets: [
                    {
                        data: [0, 0, 0],
                        backgroundColor: [
                            '#4ee100',
                            '#ff4040',
                            '#ffd700'
                        ],
                        borderColor: '#2c2c2c',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Відсоток перемог',
                        color: '#fff'
                    },
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#ccc'
                        }
                    }
                }
            }
        });
        
        this.updateWinRateChart();
    }

    updateWinRateChart() {
        if (!this.charts.winRate) return;
        
        const battles = this.dataManager.getBattlesArray();
        
        let wins = 0;
        let defeats = 0;
        let draws = 0;
        
        battles.forEach(battle => {
            if (battle.win === 1) wins++;
            else if (battle.win === 0) defeats++;
            else if (battle.win === 2) draws++;
        });
        
        this.charts.winRate.data.datasets[0].data = [wins, defeats, draws];
        this.charts.winRate.update();
    }

    createSimplePlayerChart() {
        const ctx = document.getElementById('simple-player-chart')?.getContext('2d');
        if (!ctx) return;
        
        if (this.charts.simplePlayer) {
            this.charts.simplePlayer.destroy();
        }
        
        this.charts.simplePlayer = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Середня шкода',
                        data: [],
                        backgroundColor: 'rgba(255, 156, 0, 0.7)',
                        borderColor: '#ff9c00',
                        borderWidth: 1,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Середні фраги',
                        data: [],
                        backgroundColor: 'rgba(78, 225, 0, 0.7)',
                        borderColor: '#4ee100',
                        borderWidth: 1,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Статистика шкоди та фрагів гравців',
                        color: '#fff'
                    },
                    legend: {
                        labels: {
                            color: '#ccc'
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Середня шкода',
                            color: '#aaa'
                        },
                        ticks: {
                            color: '#aaa'
                        },
                        grid: {
                            color: 'rgba(70, 70, 70, 0.2)'
                        }
                    },
                    y1: {
                        beginAtZero: true,
                        position: 'right',
                        grid: {
                            drawOnChartArea: false
                        },
                        title: {
                            display: true,
                            text: 'Середні фраги',
                            color: '#aaa'
                        },
                        ticks: {
                            color: '#aaa'
                        }
                    },
                    x: {
                        ticks: {
                            color: '#aaa'
                        },
                        grid: {
                            color: 'rgba(70, 70, 70, 0.2)'
                        }
                    }
                }
            }
        });
        
        this.updateSimplePlayerChart();
    }

    updateSimplePlayerChart() {
        if (!this.charts.simplePlayer) return;
        
        const battles = this.dataManager.getBattlesArray();
        const playerStats = {};

        battles.forEach(battle => {
            if (!battle.players) return;
            
            Object.values(battle.players).forEach(player => {
                if (!player.name) return;
                
                if (!playerStats[player.name]) {
                    playerStats[player.name] = {
                        battles: 0,
                        damage: 0,
                        kills: 0
                    };
                }
                
                const stats = playerStats[player.name];
                stats.battles++;
                stats.damage += player.damage || 0;
                stats.kills += player.kills || 0;
            });
        });

        const sortedPlayers = Object.entries(playerStats)
            .map(([name, stats]) => ({
                name,
                avgDamage: stats.damage / stats.battles || 0,
                avgKills: stats.kills / stats.battles || 0
            }))
            .sort((a, b) => b.avgDamage - a.avgDamage);
        
        const playerNames = sortedPlayers.map(p => p.name);
        const avgDamage = sortedPlayers.map(p => p.avgDamage);
        const avgKills = sortedPlayers.map(p => p.avgKills);
        
        this.charts.simplePlayer.data.labels = playerNames;
        this.charts.simplePlayer.data.datasets[0].data = avgDamage;
        this.charts.simplePlayer.data.datasets[1].data = avgKills;
        this.charts.simplePlayer.update();
    }

    createPlayerWinRateChart() {
        const ctx = document.getElementById('player-winrate-chart')?.getContext('2d');
        if (!ctx) return;
        
        if (this.charts.playerWinRate) {
            this.charts.playerWinRate.destroy();
        }
        
        this.charts.playerWinRate = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Відсоток перемог',
                        data: [],
                        backgroundColor: 'rgba(78, 225, 0, 0.7)',
                        borderColor: '#4ee100',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    title: {
                        display: true,
                        text: 'Відсоток перемог гравців',
                        color: '#fff'
                    },
                    legend: {
                        display: false
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        max: 100,
                        title: {
                            display: true,
                            text: 'Відсоток перемог',
                            color: '#aaa'
                        },
                        ticks: {
                            color: '#aaa'
                        },
                        grid: {
                            color: 'rgba(70, 70, 70, 0.2)'
                        }
                    },
                    y: {
                        ticks: {
                            color: '#aaa'
                        },
                        grid: {
                            color: 'rgba(70, 70, 70, 0.2)'
                        }
                    }
                }
            }
        });
        
        this.updatePlayerWinRateChart();
    }

    updatePlayerWinRateChart() {
        if (!this.charts.playerWinRate) return;
        
        const battles = this.dataManager.getBattlesArray();
        const playerStats = {};

        battles.forEach(battle => {
            if (!battle.players) return;
            
            Object.values(battle.players).forEach(player => {
                if (!player.name) return;
                
                if (!playerStats[player.name]) {
                    playerStats[player.name] = {
                        battles: 0,
                        wins: 0
                    };
                }
                
                const stats = playerStats[player.name];
                stats.battles++;
                if (battle.win === 1) stats.wins++;
            });
        });

        const sortedPlayers = Object.entries(playerStats)
            .map(([name, stats]) => ({
                name,
                winRate: (stats.wins / stats.battles * 100) || 0,
                battles: stats.battles
            }))
            .filter(p => p.battles >= 2) 
            .sort((a, b) => b.winRate - a.winRate);
        
        const playerNames = sortedPlayers.map(p => p.name);
        const winRates = sortedPlayers.map(p => p.winRate);
        
        this.charts.playerWinRate.data.labels = playerNames;
        this.charts.playerWinRate.data.datasets[0].data = winRates;
        this.charts.playerWinRate.update();
    }

    createSimpleVehicleChart() {
        const ctx = document.getElementById('simple-vehicle-chart')?.getContext('2d');
        if (!ctx) return;
        
        if (this.charts.simpleVehicle) {
            this.charts.simpleVehicle.destroy();
        }
        
        this.charts.simpleVehicle = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Середня шкода',
                        data: [],
                        backgroundColor: 'rgba(255, 156, 0, 0.7)',
                        borderColor: '#ff9c00',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    title: {
                        display: true,
                        text: 'Топ техніки за шкодою',
                        color: '#fff'
                    },
                    legend: {
                        display: false
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Середня шкода',
                            color: '#aaa'
                        },
                        ticks: {
                            color: '#aaa'
                        },
                        grid: {
                            color: 'rgba(70, 70, 70, 0.2)'
                        }
                    },
                    y: {
                        ticks: {
                            color: '#aaa'
                        },
                        grid: {
                            color: 'rgba(70, 70, 70, 0.2)'
                        }
                    }
                }
            }
        });
        
        this.updateSimpleVehicleChart();
    }

    updateSimpleVehicleChart() {
        if (!this.charts.simpleVehicle) return;
        
        const battles = this.dataManager.getBattlesArray();
        const vehicleStats = {};

        battles.forEach(battle => {
            if (!battle.players) return;
            
            Object.values(battle.players).forEach(player => {
                const vehicle = player.vehicle;
                if (!vehicle) return;
                
                if (!vehicleStats[vehicle]) {
                    vehicleStats[vehicle] = {
                        battles: 0,
                        damage: 0
                    };
                }
                
                vehicleStats[vehicle].battles++;
                vehicleStats[vehicle].damage += player.damage || 0;
            });
        });
        const sortedVehicles = Object.entries(vehicleStats)
            .filter(([_, stats]) => stats.battles >= 2)
            .map(([name, stats]) => ({
                name,
                avgDamage: stats.damage / stats.battles || 0,
                battles: stats.battles
            }))
            .sort((a, b) => b.avgDamage - a.avgDamage)
            .slice(0, 8); 
        
        this.charts.simpleVehicle.data.labels = sortedVehicles.map(v => v.name);
        this.charts.simpleVehicle.data.datasets[0].data = sortedVehicles.map(v => v.avgDamage);
        this.charts.simpleVehicle.update();
    }

    createVehicleWinRateChart() {
        const ctx = document.getElementById('vehicle-winrate-chart')?.getContext('2d');
        if (!ctx) return;
        
        if (this.charts.vehicleWinRate) {
            this.charts.vehicleWinRate.destroy();
        }
        
        this.charts.vehicleWinRate = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Відсоток перемог',
                        data: [],
                        backgroundColor: 'rgba(78, 225, 0, 0.7)',
                        borderColor: '#4ee100',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    title: {
                        display: true,
                        text: 'Відсоток перемог по техніці',
                        color: '#fff'
                    },
                    legend: {
                        display: false
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        max: 100,
                        title: {
                            display: true,
                            text: 'Відсоток перемог',
                            color: '#aaa'
                        },
                        ticks: {
                            color: '#aaa'
                        },
                        grid: {
                            color: 'rgba(70, 70, 70, 0.2)'
                        }
                    },
                    y: {
                        ticks: {
                            color: '#aaa'
                        },
                        grid: {
                            color: 'rgba(70, 70, 70, 0.2)'
                        }
                    }
                }
            }
        });
        
        this.updateVehicleWinRateChart();
    }

    updateVehicleWinRateChart() {
        if (!this.charts.vehicleWinRate) return;
        
        const battles = this.dataManager.getBattlesArray();
        const vehicleStats = {};

        battles.forEach(battle => {
            if (!battle.players) return;
            
            Object.values(battle.players).forEach(player => {
                const vehicle = player.vehicle;
                if (!vehicle) return;
                
                if (!vehicleStats[vehicle]) {
                    vehicleStats[vehicle] = {
                        battles: 0,
                        wins: 0
                    };
                }
                
                vehicleStats[vehicle].battles++;
                if (battle.win === 1) vehicleStats[vehicle].wins++;
            });
        });

        const sortedVehicles = Object.entries(vehicleStats)
            .filter(([_, stats]) => stats.battles >= 2) 
            .map(([name, stats]) => ({
                name,
                winRate: (stats.wins / stats.battles * 100) || 0,
                battles: stats.battles
            }))
            .sort((a, b) => b.winRate - a.winRate)
            .slice(0, 8); 
        
        this.charts.vehicleWinRate.data.labels = sortedVehicles.map(v => v.name);
        this.charts.vehicleWinRate.data.datasets[0].data = sortedVehicles.map(v => v.winRate);
        this.charts.vehicleWinRate.update();
    }

    updateBattleContributionChart(battle) {
        if (!battle || !battle.players) return;
        
        const ctx = document.getElementById('battle-contribution-chart')?.getContext('2d');
        if (!ctx) return;

        const playerNames = [];
        const playerDamage = [];
        const playerKills = [];
        
        Object.entries(battle.players).forEach(([playerId, playerData]) => {
            playerNames.push(playerData.name || 'Невідомий');
            playerDamage.push(playerData.damage || 0);
            playerKills.push(playerData.kills || 0);
        });
        
        if (this.charts.battleContribution) {
            this.charts.battleContribution.destroy();
        }
        
        this.charts.battleContribution = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: playerNames,
                datasets: [
                    {
                        label: 'Шкода',
                        data: playerDamage,
                        backgroundColor: 'rgba(255, 156, 0, 0.7)',
                        borderColor: '#ff9c00',
                        borderWidth: 1,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Фраги',
                        data: playerKills,
                        backgroundColor: 'rgba(78, 225, 0, 0.7)',
                        borderColor: '#4ee100',
                        borderWidth: 1,
                        type: 'line',
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Внесок гравців',
                        color: '#fff'
                    },
                    legend: {
                        labels: {
                            color: '#ccc'
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            color: '#aaa'
                        },
                        grid: {
                            color: 'rgba(70, 70, 70, 0.2)'
                        }
                    },
                    y: {
                        ticks: {
                            color: '#aaa'
                        },
                        grid: {
                            color: 'rgba(70, 70, 70, 0.2)'
                        },
                        title: {
                            display: true,
                            text: 'Шкода',
                            color: '#aaa'
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        ticks: {
                            color: '#aaa',
                            stepSize: 1
                        },
                        grid: {
                            drawOnChartArea: false
                        },
                        title: {
                            display: true,
                            text: 'Фраги',
                            color: '#aaa'
                        }
                    }
                }
            }
        });
    }
}

export default ChartManager;
