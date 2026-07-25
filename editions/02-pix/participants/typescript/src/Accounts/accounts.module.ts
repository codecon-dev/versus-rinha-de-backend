import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { Accounts } from './entity/account.entity';
import { TransferEntity } from '../Transfers/entity/transfers.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([Accounts, TransferEntity]),
    ],
    controllers: [AccountsController],
    providers: [AccountsService],
    exports: [TypeOrmModule],
})
export class AccountsModule { }