import { Module } from '@nestjs/common';
import { TransfersController } from './transfers.controller';
import { TransferServices } from './transfers.service';
import { TransferEntity } from './entity/transfers.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Accounts } from '../Accounts/entity/account.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([TransferEntity, Accounts]),
    ],
    controllers: [TransfersController],
    providers: [TransferServices],
})
export class TransferModule { }
