USE [ousadb]; 
SELECT 
    idnumber, lastname,firstname,email, AccountBalance,LastCleared
FROM tblStudent T1 
WHERE T1.accountbalance > 0 
  AND EXISTS 
  ( 
      SELECT 1 
      FROM tblOUSA T0 
      WHERE T1.lastcleared IN (T0.JADI_TradName, T0.JADI_Leapname) 
        AND 
        ( 
            (T0.isCurrent = 1 AND T1.ClearedCurrentSession = 0) 
            OR 
            (T0.wasCurrent = 1 AND T1.ClearedCurrentSession = 1) 
        ) 
  ); 
