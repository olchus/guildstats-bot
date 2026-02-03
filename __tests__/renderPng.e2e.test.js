const fs = require('fs');
const path = require('path');
const { renderPng } = require('../src/renderPng');

describe('renderPng - End-to-End Tests', () => {
    let outputDir;

    beforeAll(() => {
        // Use persistent test-output directory
        outputDir = path.join(__dirname, '..', 'test-output');
        
        // Create output directory if it doesn't exist
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
    });

    test('should generate actual PNG file with valid parameters', async () => {
        const params = {
            rows: [
                ['Player', 'Level', 'EXP'],
                ['Alice', '50', '+100'],
                ['Bob', '45', '+50']
            ],
            title: 'Guild Stats Report',
            ts: '2024-01-01 12:00:00',
            width: 1200,
            scale: 1
        };

        const pngBuffer = await renderPng(params);
        const outputPath = path.join(outputDir, 'test-output-1.png');

        fs.writeFileSync(outputPath, pngBuffer);

        expect(fs.existsSync(outputPath)).toBe(true);
        const fileBuffer = fs.readFileSync(outputPath);
        expect(fileBuffer.length).toBeGreaterThan(0);
        expect(fileBuffer[0]).toBe(0x89); // PNG signature first byte
    });

    test('should generate PNG with special characters in title', async () => {
        const params = {
            rows: [
                ['Guild Member', 'Status'],
                ['Test & Co.', 'Active']
            ],
            title: 'Guild "2024" <Report>',
            ts: '2024-01-01 12:00:00',
            width: 1200,
            scale: 1
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
            scale: 1
        };

        const pngBuffer = await renderPng(params);
        const outputPath = path.join(outputDir, 'test-output-3.png');

        fs.writeFileSync(outputPath, pngBuffer);

        expect(fs.existsSync(outputPath)).toBe(true);
    });

    test('should generate PNG with different dimensions', async () => {
        const params = {
            rows: [
                ['Name', 'Score'],
                ['Test', '100']
            ],
            title: 'Dimension Test',
            ts: '2024-01-01',
            width: 800,
            scale: 2
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
            scale: 1
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
                scale: 1
            };

            const pngBuffer = await renderPng(params);
            const outputPath = path.join(outputDir, `test-output-batch-${i}.png`);

            fs.writeFileSync(outputPath, pngBuffer);

            expect(fs.existsSync(outputPath)).toBe(true);
        }
    });
});
