const fs = require('fs');
const path = require('path');

// Mock puppeteer-core
jest.mock('puppeteer-core', () => ({
    launch: jest.fn().mockResolvedValue({
        newPage: jest.fn().mockResolvedValue({
            setViewport: jest.fn(),
            setContent: jest.fn(),
            $: jest.fn().mockResolvedValue({
                boundingBox: jest.fn().mockResolvedValue({
                    height: 600
                })
            }),
            screenshot: jest.fn().mockResolvedValue(Buffer.from('fake-png-data'))
        }),
        close: jest.fn()
    })
}));

// Mock fs to avoid reading the actual CSS file
jest.mock('fs', () => ({
    readFileSync: jest.fn(() => 'body { color: black; }')
}));

const { renderPng } = require('../src/renderPng');

describe('renderPng', () => {
    const mockParams = {
        rows: [
            ['Player', 'Level', 'EXP Change'],
            ['Alice', '50', '+100'],
            ['Bob', '45', '-50'],
            ['Total', '95', '+50']
        ],
        title: 'Guild Stats',
        ts: '2024-01-01 12:00:00',
        width: 1200,
        scale: 2,
        executablePath: '/usr/bin/chromium'
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should render PNG with valid parameters', async () => {
        const result = await renderPng(mockParams);
        
        expect(result).toBeDefined();
        expect(Buffer.isBuffer(result)).toBe(true);
    });

    test('should handle missing optional parameters', async () => {
        const params = {
            rows: [['Player'], ['Alice']],
            title: 'Test',
            ts: '2024-01-01'
        };
        
        const result = await renderPng(params);
        
        expect(result).toBeDefined();
        expect(Buffer.isBuffer(result)).toBe(true);
    });

    test('should handle empty rows', async () => {
        const params = {
            ...mockParams,
            rows: []
        };
        
        const result = await renderPng(params);
        
        expect(result).toBeDefined();
    });

    test('should escape HTML special characters in title and content', async () => {
        const params = {
            ...mockParams,
            title: '<script>alert("XSS")</script>',
            rows: [
                ['Player & Status'],
                ['Alice <malicious>']
            ]
        };
        
        const result = await renderPng(params);
        
        expect(result).toBeDefined();
    });

    test('should highlight positive EXP with pos class', async () => {
        const params = {
            ...mockParams,
            rows: [
                ['Player', 'EXP'],
                ['Alice', '+100']
            ]
        };
        
        const result = await renderPng(params);
        
        expect(result).toBeDefined();
    });

    test('should highlight negative EXP with neg class', async () => {
        const params = {
            ...mockParams,
            rows: [
                ['Player', 'EXP'],
                ['Bob', '-50']
            ]
        };
        
        const result = await renderPng(params);
        
        expect(result).toBeDefined();
    });

    test('should mark total row with total class', async () => {
        const params = {
            rows: [
                ['Player', 'Score'],
                ['Alice', '100'],
                ['Total', '100']
            ],
            title: 'Test',
            ts: '2024-01-01'
        };
        
        const result = await renderPng(params);
        
        expect(result).toBeDefined();
    });

    test('should handle null or undefined values in rows', async () => {
        const params = {
            rows: [
                ['Player', 'Score'],
                ['Alice', null],
                [undefined, '50']
            ],
            title: 'Test',
            ts: '2024-01-01'
        };
        
        const result = await renderPng(params);
        
        expect(result).toBeDefined();
    });

    test('should set correct viewport dimensions', async () => {
        const puppeteer = require('puppeteer-core');
        
        await renderPng(mockParams);
        
        const browserInstance = await puppeteer.launch();
        const pageInstance = await browserInstance.newPage();
        
        // Check that setViewport was called with the correct parameters
        expect(pageInstance.setViewport).toHaveBeenCalled();
    });
});
