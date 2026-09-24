#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "comiscopio_limits.h"

#define INCL_APPS_EXE_ACEFUNCS_EXCLUSIVE

#define INCL_BASE_ARCBLK
#define INCL_BASE_COMMENTS
#define INCL_BASE_CONVERT
#define INCL_BASE_DIRDATA
#define INCL_BASE_DOSFUNCS
#define INCL_BASE_ERROR
#define INCL_BASE_FILELIST
#define INCL_BASE_FUNCS
#define INCL_BASE_PATHFUNC
#define INCL_BASE_STATE
#define INCL_BASE_VOLUME

#define INCL_APPS_EXE_CONVERT
#define INCL_APPS_EXE_MESSAGES
#define INCL_APPS_EXE_OUTPTERR
#define INCL_APPS_EXE_OUTPUT

#include "apps/exe/includes.h"


/*-----------------APPS_EXE_ACEFUNCS_List--------------------------------*/

void    APPS_EXE_ACEFUNCS_List(BOOL Verbose)
{
CHAR      ShortStr[BASE_LFN_MAXLEN],
          FullStr[BASE_LFN_MAXLEN],
          SizeStr1[80],
          SizeStr2[80],
          OutputStr[160];
PCHAR     OutputFileName;
INT       I;
const char *ComiscopioListPrefix;
unsigned long long ComiscopioCount = 0, ComiscopioTotal = 0;
unsigned long long ComiscopioMaxEntries, ComiscopioMaxEntry, ComiscopioMaxTotal;
union {
tBASE_DOSFUNCS_FileTime Fields;
ULONG                   Raw;
} FileTime;

  ComiscopioListPrefix = getenv("COMISCOPIO_UNACE_LIST_PREFIX");
  ComiscopioMaxEntries = comiscopio_limit("COMISCOPIO_UNACE_MAX_ENTRIES");
  ComiscopioMaxEntry = comiscopio_limit("COMISCOPIO_UNACE_MAX_ENTRY_BYTES");
  ComiscopioMaxTotal = comiscopio_limit("COMISCOPIO_UNACE_MAX_TOTAL_BYTES");

  BASE_FILELIST_Init();
  BASE_FILELIST_VolumeCreate();

  BASE_VOLUME.DoNotProcessNextVolume =
    BASE_ARCBLK.DoOpenForReadOnly    = 1;

  if (BASE_ARCBLK_OpenArchive(BASE_DIRDATA_Dir1.ArchiveName, 0, 1, 1, 1))
  {
    sprintf(OutputStr, "%s%s %s %s",
            STR.Contents_of,
            BASE_DIRDATA_Dir1.IsLocked ? STR.__LOCKED_ : "",
            STR.archive,
            BASE_CONVERT_ToOEM(APPS_EXE_CONVERT_MakeStrShorter(ShortStr,
                                           BASE_DIRDATA_Dir1.ArchiveName, 35)));

    APPS_EXE_OUTPUT_WriteWait(OutputStr);
    APPS_EXE_OUTPUT_WriteWait("");

    APPS_EXE_OUTPUT_WriteWait(
      STR.Date_____Time__Packed______Size______Ratio_File);

    APPS_EXE_OUTPUT_WriteWait("");

    while (!BASE_ERROR_EXTERN_HandleCancel(1) && BASE_ARCBLK_LoadBlock())
    {
      if (ComiscopioListPrefix && *ComiscopioListPrefix &&
          BASE_ARCBLK.Header.Basic.HEAD_TYPE == BASE_ACESTRUC_BLOCK_FILE)
      {
        unsigned long long Size = BASE_ARCBLK.Header.File.SIZE;
        if (ComiscopioCount >= ComiscopioMaxEntries) comiscopio_limit_failure("entries");
        if (Size > ComiscopioMaxEntry) comiscopio_limit_failure("entry_bytes");
        if (Size > ComiscopioMaxTotal - ComiscopioTotal) comiscopio_limit_failure("total_bytes");
        ComiscopioCount++;
        ComiscopioTotal += Size;
        BASE_ARCBLK_GetFileName(FullStr, &BASE_ARCBLK.Header);
        printf("\n%s%llu\t%d\t", ComiscopioListPrefix, Size,
            (BASE_ARCBLK.Header.File.ATTR & BASE_DOSFUNCS_SUBDIR) != 0);
        /* Hex prevents tabs/newlines in names from forging listing records. */
        for (I = 0; FullStr[I]; I++) printf("%02x", (unsigned char)FullStr[I]);
        putchar('\n');
        continue;
      }
      if ((BASE_ARCBLK.Header.Basic.HEAD_TYPE == BASE_ACESTRUC_BLOCK_FILE)
          && !(BASE_ARCBLK.Header.File.ATTR & BASE_DOSFUNCS_SUBDIR)
          && BASE_FILELIST_Check(BASE_ARCBLK_GetFileName(ShortStr,
                                                      &BASE_ARCBLK.Header)))
      {
        strcpy(FullStr, ShortStr);

        OutputFileName = strrchr(ShortStr, '\\');

        if (Verbose || !OutputFileName)
        {
          OutputFileName = ShortStr;
        }
        else
        {
          OutputFileName++;
        }

        APPS_EXE_CONVERT_MakeStrShorter(ShortStr, OutputFileName, 35);

        FileTime.Raw = BASE_ARCBLK.Header.File.FTIME;

        BASE_STATE.SummaryUnComprBytes += BASE_ARCBLK.Header.File.SIZE;
        BASE_STATE.SummaryComprBytes   += BASE_ARCBLK.Header.File.PSIZE;
        BASE_STATE.SummaryFileCount++;

        sprintf(
          OutputStr, "%2d.%2d.%2d_%2d:%2d %c%c%s %s %4d%% %c%s",
          FileTime.Fields.Day, FileTime.Fields.Month,
          (80 + FileTime.Fields.Year) % 100,
          FileTime.Fields.Hour, FileTime.Fields.Minute,
          BASE_ARCBLK.Header.File.HEAD_FLAGS & BASE_ACESTRUC_FLAG_SPLITBEFORE ?
            '\x11' : ' ',
          BASE_ARCBLK.Header.File.HEAD_FLAGS & BASE_ACESTRUC_FLAG_SPLITAFTER  ?
            '\x10' : ' ',
          APPS_EXE_CONVERT_FormatSize(SizeStr1, 0, BASE_ARCBLK.Header.File.PSIZE),
          APPS_EXE_CONVERT_FormatSize(SizeStr2, 0, BASE_ARCBLK.Header.File.SIZE),
          APPS_EXE_CONVERT_GetPercents((INT) BASE_ARCBLK.Header.File.PSIZE,
                                      (INT) BASE_ARCBLK.Header.File.SIZE) / 10,
          BASE_ARCBLK.Header.File.HEAD_FLAGS & BASE_ACESTRUC_FLAG_PASSWORD    ?
            '*' : ' ',
          BASE_CONVERT_ToOEM(ShortStr));

        for (I = 0; I < 14; I++)
        {
          switch (OutputStr[I])
          {
            case ' ': OutputStr[I] = '0';
 break;
            case '_': OutputStr[I] = ' ';
 break;
          }
        }

        APPS_EXE_OUTPUT_WriteWait(OutputStr);

        if (Verbose)
        {
          BASE_COMMENTS_EXTERN_Output();
        }
      }
    }

/*    if (!BASE_ERROR.ErrorCode)
    {
      APPS_EXE_OUTPUT_WriteWait("");

      sprintf(OutputStr, "                 %s³%s³%4d%%³ %d %s",
              APPS_EXE_CONVERT_FormatSize(SizeStr1, 0, PackedCount),
              APPS_EXE_CONVERT_FormatSize(SizeStr2, 0, SizeCount),
              APPS_EXE_CONVERT_GetPercents(PackedCount, SizeCount) / 10,
              FileCount, FileCount == 1 ? STR.file : STR.files);

      APPS_EXE_OUTPUT_WriteWait(OutputStr);
    }
*/
    BASE_ARCBLK_EXTERN_CloseArchive(0);
  }

  BASE_FILELIST_Done();

  BASE_ARCBLK.DoOpenForReadOnly = 0;
}

