import { toolExecutionService } from '../services/tool-execution-service';

export function registerToolExecutionHandlers(registerIPCHandler: (channel: string, handler: (...args: any[]) => any) => void) {
  registerIPCHandler('execute-nikto', async (_event, args: { target: string; toolId: string }) => {
    const { target, toolId } = args;
    try {
      const result = await toolExecutionService.executeNikto(target, toolId);
      return result;
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        output: '',
        exitCode: 1
      };
    }
  });

  registerIPCHandler('execute-nuclei', async (_event, args: { target: string; toolId: string }) => {
    const { target, toolId } = args;
    try {
      const result = await toolExecutionService.executeNuclei(target, toolId);
      return result;
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        output: '',
        exitCode: 1
      };
    }
  });

  registerIPCHandler('execute-gobuster', async (_event, args: { target: string; toolId: string }) => {
    const { target, toolId } = args;
    try {
      const result = await toolExecutionService.executeGobuster(target, toolId);
      return result;
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        output: '',
        exitCode: 1
      };
    }
  });

  registerIPCHandler('execute-msfvenom', async (_event, args: { payload: string; format: string; outputFile: string; toolId: string }) => {
    const { payload, format, outputFile, toolId } = args;
    try {
      const result = await toolExecutionService.executeMsfvenom(payload, format, outputFile, toolId);
      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  registerIPCHandler('cancel-tool', async (_event, processId: string) => {
    try {
      const success = toolExecutionService.cancelProcess(processId);
      return { success };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  registerIPCHandler('get-active-tools', async () => {
    try {
      const processes = toolExecutionService.getActiveProcesses();
      return { success: true, processes };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
