const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { renderPng } = require('../src/renderPng');

describe('renderPng - End-to-End Tests', () => {
    let outputDir;
    let executablePath;

    beforeAll(async () => {
        outputDir = path.join(__dirname, '..', 'test-output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Get chromium executable path from puppeteer
        try {
            const browser = await puppeteer.launch();
            const processArgs = browser.process().spawnargs;
            executablePath = processArgs.find(arg => arg.includes('chrome'));
            await browser.close();
        } catch (err) {
            console.error('Failed to get puppeteer executable path:', err.message);
        }
    });

    test('should generate actual PNG file', async () => {
        const params = {
            rows: [['Player', 'Level', 'EXP'], ['Alice', '50', '+100']],
            title: 'Guild Stats Report',
            ts: '2024-01-01 12:00:00',
            width: 1200,
            scale: 1,
            executablePath
        };

        const pngBuffer = await renderPng(params);
        const outputPath = path.join(outputDir, 'test-output-1.png');
        fs.writeFileSync(outputPath, pngBuffer);

        expect(fs.existsSync(outputPath)).toBe(true);
        expect(pngBuffer.length).toBeGreaterThan(0);
    });

    test('should generate PNG with special characters', async () => {
        const params = {
            rows: [['Member', 'Status'], ['Test & Co.', 'Active']],
            title: 'Guild "2024" <Report>',
            ts: '2024-01-01 12:00:00',
            width: 1200,
            scale: 1,
            executablePath
        };

        const pngBuffer = await renderPng(params);
        const outputPath = path.join(outputDir, 'test-output-2.png');
        fs.writeFileSync(outputPath, pngBuffer);

        expect(fs.existsSync(outputPath)).toBe(true);
    });

    test('should generate PNG with large data set', async () => {
        const largeRows = [['Player', 'Level', 'EXP']];
        for (let i = 1; i <= 50; i++) {
            largeRows.push([`Player${i}`, `${50 + i}`, `+${i * 10}`]);
        }

        const params = {
            rows: largeRows,
            title: 'Large Guild Stats',
            ts: '2024-01-01 12:00:00',
            width: 1200,
            scale: 1,
            executablePath
        };

        const pngBuffer = await renderPng(params);
        const outputPath = path.join(outputDir, 'test-output-3.png');
        fs.writeFileSync(outputPath, pngBuffer);

        expect(fs.existsSync(outputPath)).toBe(true);
    });

    test('should generate PNG with different dimensions', async () => {
        const params = {
            rows: [['Name', 'Score'], ['Test', '100']],
            title: 'Dimension Test',
            ts: '2024-01-01',
            width: 800,
            scale: 2,
            executablePath
        };

        const pngBuffer = await renderPng(params);
        const outputPath = path.join(outputDir, 'test-output-4.png');
        fs.writeFileSync(outputPath, pngBuffer);

        expect(fs.existsSync(outputPath)).toBe(true);
    });

    test('should generate PNG with positive and negative values', async () => {
        const params = {
            rows: [
                ['Player', 'Change'],
                ['Alice', '+500'],
                ['Bob', '-200'],
                ['Total', '+300']
            ],
            title: 'EXP Changes',
            ts: '2024-01-01 12:00:00',
            width: 1200,
            scale: 1,
            executablePath
        };

        const pngBuffer = await renderPng(params);
        const outputPath = path.join(outputDir, 'test-output-5.png');
        fs.writeFileSync(outputPath, pngBuffer);

        expect(fs.existsSync(outputPath)).toBe(true);
    });

    test('should create valid PNG files for multiple renders', async () => {
        const testCases = [
            { rows: [['A', 'B'], ['1', '2']], title: 'Test 1' },
            { rows: [['X', 'Y', 'Z'], ['a', 'b', 'c']], title: 'Test 2' },
            { rows: [['Col1'], ['Val1']], title: 'Test 3' }
        ];

        for (let i = 0; i < testCases.length; i++) {
            const params = {
                ...testCases[i],
                ts: '2024-01-01',
                width: 1200,
                scale: 1,
                executablePath
            };

            const pngBuffer = await renderPng(params);
            const outputPath = path.join(outputDir, `test-output-batch-${i}.png`);
            fs.writeFileSync(outputPath, pngBuffer);

            expect(fs.existsSync(outputPath)).toBe(true);
        }
    });
});
