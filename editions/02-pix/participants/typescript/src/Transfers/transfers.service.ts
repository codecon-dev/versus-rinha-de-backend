import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TransferEntity } from './entity/transfers.entity';
import { QueryFailedError, Repository } from 'typeorm';
import { TransferirValorDTO } from './DTO/TransferirValor.dto';
import { Accounts } from '../Accounts/entity/account.entity';

@Injectable()
export class TransferServices {
    constructor(
        @InjectRepository(TransferEntity)
        private readonly transfersRepository: Repository<TransferEntity>,
        @InjectRepository(Accounts)
        private readonly accountRepository: Repository<Accounts>,
    ) { }

    async findById(id: string): Promise<TransferEntity | null> {
        return this.transfersRepository.findOne({ where: { id } });
    }

    async insert(body: TransferirValorDTO): Promise<{ transfer: TransferEntity; isNew: boolean }> {
        if (body.payerId === body.payeeId) {
            throw new UnprocessableEntityException('payerId e payeeId não podem ser iguais');
        }

        const payerAccount = await this.accountRepository.findOne({ where: { id: body.payerId } });
        if (!payerAccount) {
            throw new UnprocessableEntityException('Conta do pagador não encontrada');
        }

        const payeeAccount = await this.accountRepository.findOne({ where: { id: body.payeeId } });
        if (!payeeAccount) {
            throw new UnprocessableEntityException('Conta do recebedor não encontrada');
        }

        const transfer = new TransferEntity();
        transfer.payerId = body.payerId;
        transfer.payeeId = body.payeeId;
        transfer.amount = body.amount;
        transfer.status = 'pending';
        transfer.idempotencyKey = body.idempotencyKey;

        try {
            const saved = await this.transfersRepository.save(transfer);
            return { transfer: saved, isNew: true };
        } catch (err) {
            if (err instanceof QueryFailedError && (err as any).code === '23505') {
                const existing = await this.transfersRepository.findOne({
                    where: { idempotencyKey: body.idempotencyKey },
                });
                if (existing) {
                    return { transfer: existing, isNew: false };
                }
            }
            throw err;
        }
    }
}