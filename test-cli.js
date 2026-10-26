#!/usr/bin/env node
/**
 * CLI Automated Browser Test Runner for Bridge Defense (PlayCanvas)
 * Uses native Node.js + Chrome DevTools Protocol (CDP) over WebSocket (zero external npm dependencies).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const INDEX_PATH = path.join(__dirname, 'index.html');

function startStaticServer() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            if (req.url === '/' || req.url.startsWith('/index.html')) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(fs.readFileSync(INDEX_PATH));
            } else {
                res.writeHead(404);
                res.end('Not found');
            }
        });
        server.listen(0, '127.0.0.1', () => {
            resolve({ server, port: server.address().port });
        });
        server.on('error', reject);
    });
}

function launchChrome(url) {
    return new Promise((resolve, reject) => {
        const userDataDir = `/tmp/chrome-test-${Date.now()}`;
        const args = [
            '--headless=new',
            '--remote-debugging-port=0',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-gpu-sandbox',
            '--use-angle=metal',
            '--enable-webgl',
            '--ignore-gpu-blocklist',
            '--window-size=1280,800',
            `--user-data-dir=${userDataDir}`,
            url
        ];
        const proc = spawn(CHROME_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        const timeout = setTimeout(() => {
            proc.kill('SIGKILL');
            reject(new Error(`Timed out waiting for Chrome DevTools WS URL. Output: ${stderr}`));
        }, 10000);

        proc.stderr.on('data', chunk => {
            stderr += chunk.toString();
            const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
            if (match) {
                clearTimeout(timeout);
                resolve({ proc, wsUrl: match[1], userDataDir });
            }
        });
        proc.on('error', err => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

class CDPClient {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.ws = null;
        this.msgId = 0;
        this.pending = new Map();
        this.listeners = new Map();
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.wsUrl);
            this.ws.onopen = () => resolve();
            this.ws.onerror = err => reject(err);
            this.ws.onmessage = event => {
                const msg = JSON.parse(event.data);
                if (msg.id && this.pending.has(msg.id)) {
                    const { resolve: res, reject: rej } = this.pending.get(msg.id);
                    this.pending.delete(msg.id);
                    if (msg.error) rej(new Error(JSON.stringify(msg.error)));
                    else res(msg.result);
                } else if (msg.method) {
                    const handlers = this.listeners.get(msg.method) || [];
                    handlers.forEach(fn => fn(msg.params));
                }
            };
        });
    }

    send(method, params = {}, sessionId = undefined) {
        return new Promise((resolve, reject) => {
            const id = ++this.msgId;
            this.pending.set(id, { resolve, reject });
            const payload = { id, method, params };
            if (sessionId) payload.sessionId = sessionId;
            this.ws.send(JSON.stringify(payload));
        });
    }

    on(method, fn) {
        if (!this.listeners.has(method)) this.listeners.set(method, []);
        this.listeners.get(method).push(fn);
    }

    close() {
        if (this.ws) this.ws.close();
    }
}

async function runTests() {
    console.log('🚀 Starting Bridge Defense CLI Test Suite...');
    const { server, port } = await startStaticServer();
    const url = `http://127.0.0.1:${port}/index.html`;
    console.log(`🌐 Local server listening on ${url}`);

    const { proc, wsUrl, userDataDir } = await launchChrome(url);
    const cdp = new CDPClient(wsUrl);
    const consoleErrors = [];
    const pageExceptions = [];

    try {
        await cdp.connect();
        const { targetInfos } = await cdp.send('Target.getTargets');
        const pageTarget = targetInfos.find(t => t.type === 'page');
        if (!pageTarget) throw new Error('No page target found in headless Chrome');

        const { sessionId } = await cdp.send('Target.attachToTarget', {
            targetId: pageTarget.targetId,
            flatten: true
        });

        cdp.on('Runtime.consoleAPICalled', params => {
            if (params.type === 'error') {
                const text = (params.args || []).map(a => a.value || a.description || '').join(' ');
                consoleErrors.push(text);
            }
        });
        cdp.on('Runtime.exceptionThrown', params => {
            pageExceptions.push(params.exceptionDetails?.text || 'Unknown exception');
        });

        await cdp.send('Runtime.enable', {}, sessionId);
        await cdp.send('Page.enable', {}, sessionId);

        // Wait for window.__game to be initialized
        let ready = false;
        for (let i = 0; i < 40; i++) {
            const { result } = await cdp.send('Runtime.evaluate', {
                expression: 'Boolean(window.pc && window.__game && window.__game.app)',
                returnByValue: true
            }, sessionId);
            if (result && result.value === true) {
                ready = true;
                break;
            }
            await new Promise(r => setTimeout(r, 150));
        }
        if (!ready) throw new Error('window.__game or PlayCanvas failed to initialize within timeout');

        // Run comprehensive in-browser game verification
        const { result } = await cdp.send('Runtime.evaluate', {
            awaitPromise: true,
            returnByValue: true,
            expression: `(async () => {
                const g = window.__game;
                const report = {};

                // 1. Verify initial menu state & PlayCanvas configuration
                report.initialState = g.state;
                report.toneMapping = g.app.scene.toneMapping === pc.TONEMAP_ACES;
                report.exposure = g.app.scene.exposure;
                report.ambientBrightness = g.app.scene.ambientLight.r;
                report.fogConfigured = g.app.scene.fog === pc.FOG_LINEAR && g.app.scene.fogStart <= 75 && g.app.scene.fogEnd <= 200;
                report.roadSegments = g.segments.length;
                report.initialSoldiers = g.soldiers.length;
                report.initialLives = g.lives;
                report.texturesGenerated = ['asphalt', 'waterGrid', 'hazard', 'shadow'].every(k => TextureGenerator.cache.has(k));

                // 2. Start mission via UI click
                document.getElementById('start-game').click();
                report.playingStateAfterClick = g.state;
                report.bgmActiveOnStart = g.sound.isBgmPlaying === true && g.sound.bgmTimer !== null;

                // 3. Simulate 60 frames of active gameplay, movement, jumping, shooting, enemy & buff collisions
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
                for (let i = 0; i < 15; i++) g.loop(0.016);
                const movedRightX = g.platoonX;
                window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd' }));

                // Jump test
                window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
                g.loop(0.016);
                const airborneAfterJump = g.isAirborne && g.platoonY > 0;
                window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));

                // Land back on ground
                for (let i = 0; i < 45; i++) g.loop(0.016);

                // Spawn and hit a Buff crystal until it recruits a soldier
                const buff = new BuffEntity(g.app, g.platoonX, 1);
                g.buffs.push(buff);
                g.hitBuff(buff);
                g.removeDestroyedEntities();
                report.soldiersAfterRecruit = g.soldiers.length;

                // Spawn an enemy and kill it to verify combo, particles & shockwave
                g.spawnEnemyWave({ enemyGroupSize: 1, enemyHp: 1, enemySpeed: 0.25, bruteChance: 0 });
                const enemy = g.enemies[0];
                g.hitEnemy(enemy, { x: enemy.x, y: 1, z: enemy.z });
                g.removeDestroyedEntities();
                report.scoreAfterKill = g.score;
                report.activeParticles = g.particles.liveParticles.length;
                report.activeShockwaves = g.particles.liveRings.length;

                // Pause & Resume test
                g.togglePause();
                const pausedState = g.state;
                g.togglePause();
                const resumedState = g.state;

                // Mute toggle test
                g.toggleMute();
                const muted = g.sound.isMuted;
                g.toggleMute();

                report.movedRight = movedRightX > 0;
                report.airborneAfterJump = airborneAfterJump;
                report.pauseResumeWorked = (pausedState === 'paused' && resumedState === 'playing');
                report.muteWorked = muted === true && g.sound.isMuted === false;

                return report;
            })()`
        }, sessionId);

        const r = result.value;
        console.log('📊 Verification Results:', JSON.stringify(r, null, 2));

        const assertions = [
            ['Initial state is menu', r.initialState === 'menu'],
            ['ACES Tonemapping active & balanced exposure (1.0 - 1.3)', r.toneMapping === true && r.exposure >= 1.0 && r.exposure <= 1.3],
            ['Balanced ambient lighting (0.4 - 0.65)', r.ambientBrightness >= 0.4 && r.ambientBrightness <= 0.65],
            ['Horizon fog configured at back of map', r.fogConfigured === true],
            ['Procedural textures generated', r.texturesGenerated === true],
            ['4 infinite ocean bridge segments created', r.roadSegments === 4],
            ['Game transitions to playing on start click', r.playingStateAfterClick === 'playing'],
            ['Background adrenaline music starts playing', r.bgmActiveOnStart === true],
            ['Platoon horizontal movement works', r.movedRight === true],
            ['Jump physics & airborne state works', r.airborneAfterJump === true],
            ['Buff recruitment adds soldier (1 -> 2)', r.soldiersAfterRecruit === 2],
            ['Enemy kill awards score & spawns particles/shockwaves', r.scoreAfterKill > 0 && r.activeParticles > 0 && r.activeShockwaves > 0],
            ['Pause and resume cycle works', r.pauseResumeWorked === true],
            ['Audio mute toggle works', r.muteWorked === true],
            ['Zero console.error messages', consoleErrors.length === 0],
            ['Zero uncaught page exceptions', pageExceptions.length === 0]
        ];

        let failed = false;
        for (const [name, passed] of assertions) {
            if (passed) {
                console.log(`  ✅ ${name}`);
            } else {
                console.error(`  ❌ ${name}`);
                failed = true;
            }
        }

        if (consoleErrors.length > 0) console.error('Console errors:', consoleErrors);
        if (pageExceptions.length > 0) console.error('Page exceptions:', pageExceptions);

        if (failed) {
            process.exitCode = 1;
            console.error('\n💥 TEST SUITE FAILED');
        } else {
            console.log('\n🏆 ALL CLI BROWSER TESTS PASSED WITH ZERO ERRORS!');
        }
    } finally {
        cdp.close();
        proc.kill('SIGKILL');
        server.close();
        try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    }
}

runTests().catch(err => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
});
