import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Accounts } from './entity/account.entity';
import { QueryFailedError, Repository } from 'typeorm';
import { InserirContaDTO } from './DTO/InserirConta.dto';
import { TransferEntity } from '../Transfers/entity/transfers.entity';

@Injectable()
export class AccountsService {
    constructor(
        @InjectRepository(Accounts)
        private accountsRepository: Repository<Accounts>,
        @InjectRepository(TransferEntity)
        private transfersRepository: Repository<TransferEntity>,
    ) { }

    async findAll(): Promise<Accounts[]> {
        return this.accountsRepository.find();
    }

    async findById(id: string): Promise<Accounts | null> {
        return this.accountsRepository.findOne({ where: { id } });
    }

    async insert(body: InserirContaDTO): Promise<Accounts> {
        const account = new Accounts();
        account.id = body.id;
        account.balance = body.balance;

        try {
            return await this.accountsRepository.save(account);
        } catch (err) {
            if (err instanceof QueryFailedError && (err as any).code === '23505') {
                throw new ConflictException('Conta já existe');
            }
            throw err;
        }
    }

    async getStatement(id: string) {
        const account = await this.findById(id);
        if (!account) {
            throw new NotFoundException('Conta não encontrada');
        }

        const transfers = await this.transfersRepository.find({
            where: [
                { payerId: id, status: 'completed' },
                { payeeId: id, status: 'completed' },
            ],
            order: { createdAt: 'DESC' },
        });

        return { accountId: account.id, balance: account.balance, transfers };
    }
}