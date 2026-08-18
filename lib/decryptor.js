import { PythonShell } from 'python-shell';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Execute a Python script to decrypt a file
 * @param {string} scriptName - Python script name (without .py)
 * @param {Buffer} fileBytes - Data to decrypt
 * @returns {Promise<string>} Decryption result
 */
function runPythonScript(scriptName, fileBytes) {
    return new Promise((resolve, reject) => {
        // Create temporary file
        const tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const tempFile = path.join(tempDir, `temp_${Date.now()}_${Math.random().toString(36).slice(2)}.bin`);
        fs.writeFileSync(tempFile, fileBytes);
        
        const scriptPath = path.join(__dirname, `${scriptName}.py`);
        
        if (!fs.existsSync(scriptPath)) {
            fs.unlinkSync(tempFile);
            reject(new Error(`Script ${scriptName}.py not found`));
            return;
        }
        
        const options = {
            mode: 'text',
            pythonOptions: ['-u'],
            args: [tempFile],
            pythonPath: process.env.PYTHON_PATH || 'python3',
            scriptPath: __dirname
        };
        
        const pyshell = new PythonShell(`${scriptName}.py`, options);
        let output = '';
        let error = '';
        
        pyshell.on('message', (message) => {
            output += message + '\n';
        });
        
        pyshell.on('stderr', (stderr) => {
            error += stderr;
            console.error('Python stderr:', stderr);
        });
        
        pyshell.on('error', (err) => {
            console.error('Python error:', err);
            try { fs.unlinkSync(tempFile); } catch (e) {}
            reject(err);
        });
        
        pyshell.on('close', (code) => {
            try { fs.unlinkSync(tempFile); } catch (e) {}
            
            if (code !== 0) {
                reject(new Error(`Python script exited with code ${code}: ${error}`));
            } else {
                resolve(output.trim());
            }
        });
    });
}

// Synchronous version with execSync (fallback)
function runPythonScriptSync(scriptName, fileBytes) {
    try {
        const tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        
        const tempFile = path.join(tempDir, `temp_${Date.now()}.bin`);
        fs.writeFileSync(tempFile, fileBytes);
        
        const scriptPath = path.join(__dirname, `${scriptName}.py`);
        if (!fs.existsSync(scriptPath)) {
            fs.unlinkSync(tempFile);
            throw new Error(`Script ${scriptName}.py not found`);
        }
        
        const pythonPath = process.env.PYTHON_PATH || 'python3';
        const result = execSync(`"${pythonPath}" "${scriptPath}" "${tempFile}"`, {
            encoding: 'utf-8',
            timeout: 30000,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        fs.unlinkSync(tempFile);
        return result.trim() || null;
    } catch (error) {
        console.error(`${scriptName} decrypt error:`, error.message);
        return null;
    }
}

// Export async decrypt functions
export async function decryptSSC(fileBytes) {
    try {
        return await runPythonScript('SSCCUSTOM', fileBytes);
    } catch (error) {
        console.error('SSC decrypt error:', error.message);
        return null;
    }
}

export async function decryptDarkTunnel(fileBytes) {
    try {
        return await runPythonScript('DARKTUNNEL', fileBytes);
    } catch (error) {
        console.error('DarkTunnel decrypt error:', error.message);
        return null;
    }
}

export async function decryptHTTPCustom(fileBytes) {
    try {
        return await runPythonScript('HTTPCUSTOM', fileBytes);
    } catch (error) {
        console.error('HTTPCustom decrypt error:', error.message);
        return null;
    }
}

export async function decryptHTTPInjector(fileBytes) {
    try {
        return await runPythonScript('HTTPINJECTOR', fileBytes);
    } catch (error) {
        console.error('HTTPInjector decrypt error:', error.message);
        return null;
    }
}

export async function decryptNPVTunnel(fileBytes) {
    try {
        return await runPythonScript('NPVTUNNEL', fileBytes);
    } catch (error) {
        console.error('NPVTunnel decrypt error:', error.message);
        return null;
    }
}

// Sync versions for compatibility
export function decryptSSCSync(fileBytes) {
    return runPythonScriptSync('SSCCUSTOM', fileBytes);
}

export function decryptDarkTunnelSync(fileBytes) {
    return runPythonScriptSync('DARKTUNNEL', fileBytes);
}

export function decryptHTTPCustomSync(fileBytes) {
    return runPythonScriptSync('HTTPCUSTOM', fileBytes);
}

export function decryptHTTPInjectorSync(fileBytes) {
    return runPythonScriptSync('HTTPINJECTOR', fileBytes);
}

export function decryptNPVTunnelSync(fileBytes) {
    return runPythonScriptSync('NPVTUNNEL', fileBytes);
}

export default {
    decryptSSC,
    decryptDarkTunnel,
    decryptHTTPCustom,
    decryptHTTPInjector,
    decryptNPVTunnel,
    decryptSSCSync,
    decryptDarkTunnelSync,
    decryptHTTPCustomSync,
    decryptHTTPInjectorSync,
    decryptNPVTunnelSync
};