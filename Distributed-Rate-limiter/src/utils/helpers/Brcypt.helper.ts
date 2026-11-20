import bcrypt from 'bcrypt';
import { serverConfig } from '../../config';
import logger from '../../config/logger.config';


class BcryptHelperClass {
  async checkPasswordService(plainPassword: string, hash: string): Promise<boolean> {
    try {
      // Use async compare to offload to the libuv worker pool
      const match = await bcrypt.compare(plainPassword, hash);
      return match;
    } catch (error) {
      logger.error('Error in bcrypt helper layer (checkPasswordService)', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message, { cause: error });
    }
  }
  async generateHashService(plainPassword: string): Promise<string> {
    try {
      const salt = await bcrypt.genSalt(serverConfig.SALT_ROUNDS);
      const hash = await bcrypt.hash(plainPassword, salt);
      return hash;
    } catch (error) {
      logger.error('Error in bcrypt helper layer (generateHashService)', error);
      throw error;
    }
  }
}

const bcryptHelper = new BcryptHelperClass();
export default bcryptHelper;
