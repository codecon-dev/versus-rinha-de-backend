import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'aaaaaaa';
  }

  transferFunds(
    amount: number,
    fromAccount: string,
    toAccount: string,
  ): boolean {
    console.log(`Transferindo ${amount} de ${fromAccount} para ${toAccount}`);
    return true;
  }
}
