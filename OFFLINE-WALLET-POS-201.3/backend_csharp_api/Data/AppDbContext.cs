using Microsoft.EntityFrameworkCore;
using Pos2013.Api.Models;
using Pos2013.Api.Models.FundCatcher;

namespace Pos2013.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options)
        : base(options) { }

    public DbSet<Merchant> Merchants => Set<Merchant>();
    public DbSet<PaymentCode> PaymentCodes => Set<PaymentCode>();
    public DbSet<Terminal> Terminals => Set<Terminal>();
    
    // Fund Catcher Engine DbSets
    public DbSet<TransactionSnapshot> TransactionSnapshots => Set<TransactionSnapshot>();
    public DbSet<FundRecovery> FundRecoveries => Set<FundRecovery>();
    public DbSet<FundCatcherEngineRun> EngineRuns => Set<FundCatcherEngineRun>();
    public DbSet<FundCatcherAuditLog> AuditLogs => Set<FundCatcherAuditLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Merchant>(e =>
        {
            e.ToTable("Merchants");
            e.HasKey(x => x.Id);
            e.Property(x => x.MerchantId).HasMaxLength(64);
        });

        modelBuilder.Entity<Terminal>(e =>
        {
            e.ToTable("Terminals");
            e.HasKey(x => x.Id);
            e.Property(x => x.TerminalId).HasMaxLength(64);
        });

        modelBuilder.Entity<PaymentCode>(e =>
        {
            e.ToTable("PaymentCodes");
            e.HasKey(x => x.Id);

            e.Property(x => x.Code).HasMaxLength(6);
            e.Property(x => x.Stan).HasMaxLength(6);
            e.Property(x => x.Amount).HasColumnType("decimal(18,2)");
            e.Property(x => x.Currency).HasMaxLength(10);
            e.Property(x => x.PanMasked).HasMaxLength(32);
            e.Property(x => x.MerchantId).HasMaxLength(64);
            e.Property(x => x.TerminalId).HasMaxLength(64);
        });
        
        // Fund Catcher Engine Entities
        modelBuilder.Entity<TransactionSnapshot>(e =>
        {
            e.ToTable("TransactionSnapshots");
            e.HasKey(x => x.Id);
            
            e.Property(x => x.RRN).HasMaxLength(128);
            e.Property(x => x.STAN).HasMaxLength(128);
            e.Property(x => x.Amount).HasColumnType("decimal(18,4)");
            e.Property(x => x.Currency).HasMaxLength(10);
            
            e.Property(x => x.PosStatus).HasMaxLength(50);
            e.Property(x => x.PosAuthCode).HasMaxLength(128);
            
            e.Property(x => x.LedgerStatus).HasMaxLength(50);
            e.Property(x => x.LedgerAmount).HasColumnType("decimal(18,4)");
            
            e.Property(x => x.GatewayStatus).HasMaxLength(50);
            e.Property(x => x.GatewayTransactionId).HasMaxLength(128);
            
            e.Property(x => x.BankStatus).HasMaxLength(50);
            e.Property(x => x.BankSettlementId).HasMaxLength(128);
            
            e.Property(x => x.PayoutStatus).HasMaxLength(50);
            e.Property(x => x.PayoutReference).HasMaxLength(128);
            
            e.Property(x => x.OwnerType).HasMaxLength(50);
            e.Property(x => x.MismatchReason).HasMaxLength(500);
        });
        
        modelBuilder.Entity<FundRecovery>(e =>
        {
            e.ToTable("FundRecoveries");
            e.HasKey(x => x.Id);
            
            e.Property(x => x.RecoveryAction).HasMaxLength(256);
            e.Property(x => x.RecoveryDetails).HasColumnType("TEXT"); // JSON
            e.Property(x => x.RecoveredAmount).HasColumnType("decimal(18,4)");
            e.Property(x => x.RecoveryReference).HasMaxLength(128);
            e.Property(x => x.BeneficiaryType).HasMaxLength(50);
            e.Property(x => x.ErrorMessage).HasMaxLength(500);
            
            e.HasIndex(x => x.TransactionSnapshotId);
            e.HasIndex(x => x.Status);
            e.HasIndex(x => x.CreatedAt);
        });
        
        modelBuilder.Entity<FundCatcherEngineRun>(e =>
        {
            e.ToTable("EngineRuns");
            e.HasKey(x => x.Id);
            
            e.Property(x => x.RunId).HasMaxLength(128);
            e.Property(x => x.TotalRecoveredAmount).HasColumnType("decimal(18,4)");
            e.Property(x => x.Currency).HasMaxLength(10);
            e.Property(x => x.Details).HasColumnType("TEXT"); // JSON
            
            e.HasIndex(x => x.RunId);
            e.HasIndex(x => x.StartedAt);
        });
        
        modelBuilder.Entity<FundCatcherAuditLog>(e =>
        {
            e.ToTable("AuditLogs");
            e.HasKey(x => x.Id);
            
            e.Property(x => x.EventType).HasMaxLength(100);
            e.Property(x => x.Message).HasMaxLength(1000);
            e.Property(x => x.Details).HasColumnType("TEXT"); // JSON
            e.Property(x => x.AffectedSystem).HasMaxLength(100);
            e.Property(x => x.AffectedEntityId).HasMaxLength(128);
            e.Property(x => x.SeverityLevel).HasMaxLength(20);
            
            e.HasIndex(x => x.EventType);
            e.HasIndex(x => x.CreatedAt);
        });
    }
}
