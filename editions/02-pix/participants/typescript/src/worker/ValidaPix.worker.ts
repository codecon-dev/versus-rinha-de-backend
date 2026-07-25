import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TransferEntity } from '../Transfers/entity/transfers.entity';
import { Accounts } from '../Accounts/entity/account.entity';

@Injectable()
export class ValidaPixWorker implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(ValidaPixWorker.name);
    private timer: NodeJS.Timeout | null = null;
    private running = false;

  constructor(
    private readonly dataSource: DataSource
  ) { }

    onModuleInit() {
        this.timer = setInterval(() => this.tick(), 200);
    }

    onModuleDestroy() {
        if (this.timer) clearInterval(this.timer);
    }

    private async tick() {
        if (this.running) return;
        this.running = true;
        try {
            await this.processPending();
        } catch (err) {
            this.logger.error('Erro ao processar transferências pendentes', err as Error);
        } finally {
            this.running = false;
        }
    }

    private async processPending() {
        await this.dataSource.transaction(async (manager) => {
            const pending = await manager
                .createQueryBuilder(TransferEntity, 't')
                .where('t.status = :status', { status: 'pending' })
                .orderBy('t.createdAt', 'ASC')
                .limit(50)
                .setLock('pessimistic_write')
                .setOnLocked('skip_locked')
                .getMany();

            for (const transfer of pending) {
                await this.settle(manager, transfer);
            }
        });
    }

    private async settle(manager: any, transfer: TransferEntity) {
        const [firstId, secondId] = [transfer.payerId, transfer.payeeId].sort();

        const firstAccount = await manager
            .createQueryBuilder(Accounts, 'a')
            .where('a.id = :id', { id: firstId })
            .setLock('pessimistic_write')
            .getOne();
        const secondAccount = await manager
            .createQueryBuilder(Accounts, 'a')
            .where('a.id = :id', { id: secondId })
            .setLock('pessimistic_write')
            .getOne();

        const byId = new Map<string, Accounts>();
        if (firstAccount) byId.set(firstAccount.id, firstAccount);
        if (secondAccount) byId.set(secondAccount.id, secondAccount);

        const payerAccount = transfer.payerId ? byId.get(transfer.payerId) : undefined;
        const payeeAccount = transfer.payeeId ? byId.get(transfer.payeeId) : undefined;

        if (!payerAccount || !payeeAccount) {
            transfer.status = 'failed';
            transfer.failureReason = 'account_not_found';
            await manager.save(transfer);
            return;
        }

        const amount = typeof transfer.amount === 'number' && Number.isFinite(transfer.amount) ? transfer.amount : undefined;

        if (amount !== undefined && payerAccount.balance !== undefined && payeeAccount.balance !== undefined && payerAccount.balance >= amount) {
            payerAccount.balance -= amount;
            payeeAccount.balance += amount;
            transfer.status = 'completed';
            transfer.failureReason = null;
            await manager.save(payerAccount);
            await manager.save(payeeAccount);
        } else {
            transfer.status = 'failed';
            transfer.failureReason = 'insufficient_funds';
        }

        await manager.save(transfer);
    }
}
